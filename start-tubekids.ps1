param([switch]$NoBrowser, [string]$VideoFolder)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Resolve-VideoFolder {
    param([string]$Override)

    # 1. פרמטר מפורש, 2. משתנה סביבה, 3. תיקיית הווידאו של המשתמש, 4. ברירת מחדל
    if ($Override) { return [IO.Path]::GetFullPath($Override) }
    if ($env:TUBEKIDS_VIDEO_FOLDER) { return [IO.Path]::GetFullPath($env:TUBEKIDS_VIDEO_FOLDER) }

    # קריאה מהרישום תופסת גם הפניה של תיקיית הווידאו ל־OneDrive או לכונן אחר
    try {
        $shellFolders = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
        $raw = (Get-ItemProperty -LiteralPath $shellFolders -Name 'My Video' -ErrorAction Stop).'My Video'
        $expanded = [Environment]::ExpandEnvironmentVariables($raw)
        if ($expanded -and $expanded.Trim()) { return [IO.Path]::GetFullPath($expanded) }
    } catch { }

    $known = [Environment]::GetFolderPath('MyVideos')
    if ($known -and $known.Trim()) { return [IO.Path]::GetFullPath($known) }

    return [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Videos'))
}

$videoFolder = Resolve-VideoFolder -Override $VideoFolder
$port = 17853
$appUrl = "http://127.0.0.1:$port/index.html"
$videoExtensions = @('.mp4', '.webm', '.ogv', '.mov', '.m4v')

if (-not (Test-Path -LiteralPath $videoFolder -PathType Container)) {
    New-Item -ItemType Directory -Path $videoFolder -Force | Out-Null
}

function Open-TubeKidsWindow {
    param([string]$Url)

    $programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
    $programFiles = [Environment]::GetFolderPath('ProgramFiles')
    $localAppData = [Environment]::GetFolderPath('LocalApplicationData')
    $browserCandidates = @(
        (Join-Path $programFilesX86 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $programFiles 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $programFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $localAppData 'Google\Chrome\Application\chrome.exe')
    )
    $browser = $browserCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

    if ($browser) {
        Start-Process -FilePath $browser -ArgumentList @("--app=$Url", '--start-maximized')
    } else {
        Start-Process $Url
    }
}

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
try {
    $listener.Start()
} catch {
    if (-not $NoBrowser) { Open-TubeKidsWindow -Url $appUrl }
    exit 0
}

if (-not $NoBrowser) { Open-TubeKidsWindow -Url $appUrl }
$lastRequest = [DateTime]::UtcNow
$rootWithSeparator = [IO.Path]::GetFullPath($projectRoot).TrimEnd('\') + '\'
$videoRootWithSeparator = [IO.Path]::GetFullPath($videoFolder).TrimEnd('\') + '\'
$mimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.mp4'  = 'video/mp4'
    '.m4v'  = 'video/mp4'
    '.webm' = 'video/webm'
    '.ogv'  = 'video/ogg'
    '.mov'  = 'video/quicktime'
}

try {
    while (([DateTime]::UtcNow - $lastRequest).TotalSeconds -lt 150) {
        if (-not $listener.Pending()) {
            Start-Sleep -Milliseconds 100
            continue
        }

        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
            $requestLine = $reader.ReadLine()
            $headers = @{}
            while ($headerLine = $reader.ReadLine()) {
                $separator = $headerLine.IndexOf(':')
                if ($separator -gt 0) {
                    $headers[$headerLine.Substring(0, $separator).Trim().ToLowerInvariant()] = $headerLine.Substring($separator + 1).Trim()
                }
            }
            $lastRequest = [DateTime]::UtcNow

            if (-not $requestLine) { continue }
            $target = ($requestLine -split ' ')[1]
            $requestPath = ([Uri]"http://127.0.0.1$target").AbsolutePath

            if ($requestPath -eq '/__ping') {
                $header = "HTTP/1.1 204 No Content`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
                $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
                $stream.Write($headerBytes, 0, $headerBytes.Length)
                continue
            }

            if ($requestPath -eq '/__videos') {
                $videos = @(Get-ChildItem -LiteralPath $videoFolder -File -Recurse -ErrorAction SilentlyContinue |
                    Where-Object { $videoExtensions -contains $_.Extension.ToLowerInvariant() } |
                    Sort-Object FullName |
                    ForEach-Object {
                        $relative = $_.FullName.Substring($videoRootWithSeparator.Length).Replace('\', '/')
                        $segments = $relative.Split('/') | ForEach-Object { [Uri]::EscapeDataString($_) }
                        $parent = [IO.Path]::GetDirectoryName($relative)
                        [PSCustomObject]@{
                            id = "file:$relative"
                            src = '/__video/' + ($segments -join '/')
                            title = [IO.Path]::GetFileNameWithoutExtension($_.Name)
                            category = if ($parent) { $parent.Split([char[]]@('/', '\'))[0] } else { 'סרטונים' }
                        }
                    })
                $json = [PSCustomObject]@{ folder = $videoFolder; videos = $videos } | ConvertTo-Json -Depth 4 -Compress
                $body = [Text.Encoding]::UTF8.GetBytes($json)
                $header = "HTTP/1.1 200 OK`r`nContent-Type: application/json; charset=utf-8`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
                $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
                $stream.Write($headerBytes, 0, $headerBytes.Length)
                $stream.Write($body, 0, $body.Length)
                continue
            }

            if ($requestPath.StartsWith('/__video/', [StringComparison]::Ordinal)) {
                $relativeVideoPath = [Uri]::UnescapeDataString($requestPath.Substring(9)).Replace('/', '\')
                $fullVideoPath = [IO.Path]::GetFullPath((Join-Path $videoFolder $relativeVideoPath))
                $extension = [IO.Path]::GetExtension($fullVideoPath).ToLowerInvariant()
                if (-not $fullVideoPath.StartsWith($videoRootWithSeparator, [StringComparison]::OrdinalIgnoreCase) -or
                    -not (Test-Path -LiteralPath $fullVideoPath -PathType Leaf) -or $videoExtensions -notcontains $extension) {
                    $body = [Text.Encoding]::UTF8.GetBytes('Not found')
                    $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
                    $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
                    $stream.Write($headerBytes, 0, $headerBytes.Length)
                    $stream.Write($body, 0, $body.Length)
                    continue
                }

                $fileInfo = Get-Item -LiteralPath $fullVideoPath
                [long]$start = 0
                [long]$end = $fileInfo.Length - 1
                $status = '200 OK'
                $contentRange = ''
                if ($headers.ContainsKey('range') -and $headers['range'] -match '^bytes=(\d*)-(\d*)') {
                    if ($Matches[1]) { $start = [long]$Matches[1] }
                    if ($Matches[2]) { $end = [Math]::Min([long]$Matches[2], $end) }
                    if ($start -gt $end -or $start -ge $fileInfo.Length) {
                        $header = "HTTP/1.1 416 Range Not Satisfiable`r`nContent-Range: bytes */$($fileInfo.Length)`r`nConnection: close`r`n`r`n"
                        $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
                        $stream.Write($headerBytes, 0, $headerBytes.Length)
                        continue
                    }
                    $status = '206 Partial Content'
                    $contentRange = "Content-Range: bytes $start-$end/$($fileInfo.Length)`r`n"
                }
                $length = $end - $start + 1
                $mime = $mimeTypes[$extension]
                $header = "HTTP/1.1 $status`r`nContent-Type: $mime`r`nContent-Length: $length`r`nAccept-Ranges: bytes`r`n$contentRange" + "Cache-Control: no-cache`r`nConnection: close`r`n`r`n"
                $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
                $stream.Write($headerBytes, 0, $headerBytes.Length)
                $fileStream = [IO.File]::OpenRead($fullVideoPath)
                try {
                    [void]$fileStream.Seek($start, [IO.SeekOrigin]::Begin)
                    $buffer = New-Object byte[] 65536
                    [long]$remaining = $length
                    while ($remaining -gt 0) {
                        $read = $fileStream.Read($buffer, 0, [Math]::Min($buffer.Length, $remaining))
                        if ($read -le 0) { break }
                        $stream.Write($buffer, 0, $read)
                        $remaining -= $read
                    }
                } finally { $fileStream.Dispose() }
                continue
            }

            $relativePath = [Uri]::UnescapeDataString($requestPath.TrimStart('/')).Replace('/', '\')
            if (-not $relativePath) { $relativePath = 'index.html' }
            $fullPath = [IO.Path]::GetFullPath((Join-Path $projectRoot $relativePath))

            if (-not $fullPath.StartsWith($rootWithSeparator, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
                $body = [Text.Encoding]::UTF8.GetBytes('Not found')
                $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
            } else {
                $body = [IO.File]::ReadAllBytes($fullPath)
                $extension = [IO.Path]::GetExtension($fullPath).ToLowerInvariant()
                $mime = if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { 'application/octet-stream' }
                $header = "HTTP/1.1 200 OK`r`nContent-Type: $mime`r`nContent-Length: $($body.Length)`r`nCache-Control: no-cache`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n"
            }

            $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
            $stream.Write($headerBytes, 0, $headerBytes.Length)
            $stream.Write($body, 0, $body.Length)
        } catch {
            # A dropped browser request should not stop the local app.
        } finally {
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}
