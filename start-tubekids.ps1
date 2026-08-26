param([switch]$NoBrowser, [string]$VideoFolder)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Resolve-UserVideosFolder {
    # קריאה מהרישום תופסת גם הפניה של תיקיית הווידאו ל־OneDrive או לכונן אחר
    try {
        $shellFolders = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
        $raw = (Get-ItemProperty -LiteralPath $shellFolders -Name 'My Video' -ErrorAction Stop).'My Video'
        $expanded = [Environment]::ExpandEnvironmentVariables($raw)
        if ($expanded -and $expanded.Trim()) { return $expanded }
    } catch { }

    $known = [Environment]::GetFolderPath('MyVideos')
    if ($known -and $known.Trim()) { return $known }

    return (Join-Path $env:USERPROFILE 'Videos')
}

function Resolve-VideoFolder {
    param([string]$Override)

    # 1. פרמטר מפורש, 2. משתנה סביבה — שניהם נתיב מלא כמות שהוא
    if ($Override) { return [IO.Path]::GetFullPath($Override) }
    if ($env:TUBEKIDS_VIDEO_FOLDER) { return [IO.Path]::GetFullPath($env:TUBEKIDS_VIDEO_FOLDER) }

    # ברירת המחדל: תת־תיקיית TubeKids בתוך תיקיית הווידאו של המשתמש
    return [IO.Path]::GetFullPath((Join-Path (Resolve-UserVideosFolder) 'TubeKids'))
}

$videoFolder = Resolve-VideoFolder -Override $VideoFolder
$thumbFolder = Join-Path $env:LOCALAPPDATA 'TubeKids\thumbs'
$port = 17853
$appUrl = "http://127.0.0.1:$port/index.html"
$videoExtensions = @('.mp4', '.webm', '.ogv', '.mov', '.m4v')
$idleTimeoutSeconds = 150
$maxWorkers = 24

foreach ($folder in @($videoFolder, $thumbFolder)) {
    if (-not (Test-Path -LiteralPath $folder -PathType Container)) {
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
    }
}

# ---------- עזר מנוהל: תמונה ממוזערת מווינדוס + אורך סרטון מכותרת הקובץ ----------
if (-not ('TubeKids.Media' -as [type])) {
    Add-Type -ReferencedAssemblies 'System.Drawing' -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace TubeKids {
    public static class Media {

        // ----- אורך הסרטון מאטום mvhd (mp4 / m4v / mov) -----
        public static double GetDurationSeconds(string path) {
            try {
                using (FileStream fs = File.OpenRead(path)) {
                    return FindMvhd(fs, 0, fs.Length, 0);
                }
            } catch { return 0; }
        }

        static double FindMvhd(FileStream fs, long pos, long end, int depth) {
            if (depth > 4) return 0;
            byte[] head = new byte[8];
            while (pos + 8 <= end) {
                fs.Position = pos;
                if (fs.Read(head, 0, 8) != 8) return 0;
                long size = ReadU32(head, 0);
                string type = Encoding.ASCII.GetString(head, 4, 4);
                long headerSize = 8;
                if (size == 1) {
                    byte[] big = new byte[8];
                    if (fs.Read(big, 0, 8) != 8) return 0;
                    size = (long)ReadU64(big, 0);
                    headerSize = 16;
                } else if (size == 0) {
                    size = end - pos;
                }
                if (size < headerSize || pos + size > end) return 0;

                if (type == "moov") {
                    double inner = FindMvhd(fs, pos + headerSize, pos + size, depth + 1);
                    if (inner > 0) return inner;
                } else if (type == "mvhd") {
                    fs.Position = pos + headerSize;
                    byte[] b = new byte[32];
                    int read = fs.Read(b, 0, 32);
                    if (b[0] == 1 && read >= 32) {
                        uint scale = ReadU32(b, 20);
                        ulong ticks = ReadU64(b, 24);
                        if (scale > 0) return (double)ticks / scale;
                    } else if (b[0] == 0 && read >= 20) {
                        uint scale = ReadU32(b, 12);
                        uint ticks = ReadU32(b, 16);
                        if (scale > 0) return (double)ticks / scale;
                    }
                    return 0;
                }
                pos += size;
            }
            return 0;
        }

        static uint ReadU32(byte[] b, int i) {
            return ((uint)b[i] << 24) | ((uint)b[i + 1] << 16) | ((uint)b[i + 2] << 8) | b[i + 3];
        }
        static ulong ReadU64(byte[] b, int i) {
            return ((ulong)ReadU32(b, i) << 32) | ReadU32(b, i + 4);
        }

        // ----- תמונה ממוזערת דרך מנגנון התמונות של ווינדוס -----
        [StructLayout(LayoutKind.Sequential)]
        struct NativeSize { public int cx; public int cy; }

        [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IShellItemImageFactory {
            [PreserveSig] int GetImage(NativeSize size, int flags, out IntPtr phbm);
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
        static extern void SHCreateItemFromParsingName(
            [MarshalAs(UnmanagedType.LPWStr)] string path, IntPtr bindingContext,
            ref Guid interfaceId, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory factory);

        [DllImport("gdi32.dll")]
        static extern bool DeleteObject(IntPtr handle);

        const int ThumbnailOnly = 0x08; // עדיף להיכשל מלהחזיר אייקון גנרי

        // ה־COM של התמונות הממוזערות דורש STA, ולכן הקריאה מתבצעת בתהליכון משלה
        public static bool SaveThumbnail(string videoPath, string outputPath, int width, int height) {
            bool ok = false;
            Thread worker = new Thread(delegate () { ok = SaveCore(videoPath, outputPath, width, height); });
            worker.SetApartmentState(ApartmentState.STA);
            worker.IsBackground = true;
            worker.Start();
            if (!worker.Join(25000)) return false;
            return ok;
        }

        static bool SaveCore(string videoPath, string outputPath, int width, int height) {
            IntPtr bitmapHandle = IntPtr.Zero;
            try {
                Guid interfaceId = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
                IShellItemImageFactory factory;
                SHCreateItemFromParsingName(videoPath, IntPtr.Zero, ref interfaceId, out factory);
                NativeSize size; size.cx = width; size.cy = height;
                if (factory.GetImage(size, ThumbnailOnly, out bitmapHandle) != 0 || bitmapHandle == IntPtr.Zero) {
                    return false;
                }
                string temp = outputPath + ".part";
                using (Bitmap bitmap = Image.FromHbitmap(bitmapHandle)) {
                    bitmap.Save(temp, ImageFormat.Jpeg);
                }
                if (File.Exists(outputPath)) File.Delete(outputPath);
                File.Move(temp, outputPath);
                return true;
            } catch {
                return false;
            } finally {
                if (bitmapHandle != IntPtr.Zero) DeleteObject(bitmapHandle);
            }
        }
    }
}
'@
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

$context = [hashtable]::Synchronized(@{
    ProjectRoot     = [IO.Path]::GetFullPath($projectRoot)
    VideoFolder     = $videoFolder
    ThumbFolder     = $thumbFolder
    RootPrefix      = [IO.Path]::GetFullPath($projectRoot).TrimEnd('\') + '\'
    VideoPrefix     = [IO.Path]::GetFullPath($videoFolder).TrimEnd('\') + '\'
    VideoExtensions = $videoExtensions
    ThumbLock       = New-Object object
    LastRequest     = [DateTime]::UtcNow
    MimeTypes       = @{
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
})

# כל חיבור מטופל ב־runspace נפרד, כדי שנגן שמחזיק חיבור פתוח לא יחסום את שאר הבקשות
$handler = {
    param($context, $client)

    $ErrorActionPreference = 'Continue'

    function Write-Head {
        param($Stream, [string]$Status, [string]$ContentType, [long]$Length, [string]$Extra = '')
        $head = "HTTP/1.1 $Status`r`nContent-Type: $ContentType`r`nContent-Length: $Length`r`n$Extra" +
                "Connection: close`r`n`r`n"
        $bytes = [Text.Encoding]::ASCII.GetBytes($head)
        $Stream.Write($bytes, 0, $bytes.Length)
    }
    function Write-Body {
        param($Stream, [string]$Status, [string]$ContentType, [byte[]]$Body, [string]$Extra = '')
        Write-Head -Stream $Stream -Status $Status -ContentType $ContentType -Length $Body.Length -Extra $Extra
        if ($Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
    }
    function Write-NotFound {
        param($Stream)
        Write-Body -Stream $Stream -Status '404 Not Found' -ContentType 'text/plain; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes('Not found'))
    }
    function Resolve-Inside {
        param([string]$Root, [string]$Prefix, [string]$Relative)
        if (-not $Relative) { return $null }
        if ($Relative.Contains('..')) { return $null }
        $full = [IO.Path]::GetFullPath((Join-Path $Root $Relative))
        if (-not $full.StartsWith($Prefix, [StringComparison]::OrdinalIgnoreCase)) { return $null }
        return $full
    }
    function Get-ThumbBasePath {
        param($Context, [IO.FileInfo]$File)
        $seed = "$($File.FullName)|$($File.LastWriteTimeUtc.Ticks)|$($File.Length)"
        $sha = [Security.Cryptography.SHA1]::Create()
        try {
            $hash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($seed))).Replace('-', '')
        } finally { $sha.Dispose() }
        return (Join-Path $Context.ThumbFolder $hash)
    }

    try {
        $client.NoDelay = $true
        $client.ReceiveTimeout = 15000
        $client.SendTimeout = 60000   # נגן שהפסיק לצרוך משחרר את ה־runspace במקום לתקוע אותו
        $stream = $client.GetStream()
        $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
        $requestLine = $reader.ReadLine()
        if (-not $requestLine) { return }

        $headers = @{}
        while ($headerLine = $reader.ReadLine()) {
            $separator = $headerLine.IndexOf(':')
            if ($separator -gt 0) {
                $headers[$headerLine.Substring(0, $separator).Trim().ToLowerInvariant()] = $headerLine.Substring($separator + 1).Trim()
            }
        }
        $context.LastRequest = [DateTime]::UtcNow

        $target = ($requestLine -split ' ')[1]
        $requestPath = ([Uri]"http://127.0.0.1$target").AbsolutePath

        if ($requestPath -eq '/__ping') {
            $bytes = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 204 No Content`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n")
            $stream.Write($bytes, 0, $bytes.Length)
            return
        }

        if ($requestPath -eq '/__videos') {
            $categoryDirectories = @(Get-ChildItem -LiteralPath $context.VideoFolder -Directory -ErrorAction SilentlyContinue | Sort-Object Name)
            $categories = @($categoryDirectories | ForEach-Object {
                $categoryImage = Join-Path $_.FullName 'category.jpg'
                [PSCustomObject]@{
                    name = $_.Name
                    image = if (Test-Path -LiteralPath $categoryImage -PathType Leaf) {
                        '/__category/' + [Uri]::EscapeDataString($_.Name)
                    } else { $null }
                }
            })
            $videos = @(Get-ChildItem -LiteralPath $context.VideoFolder -File -Recurse -ErrorAction SilentlyContinue |
                Where-Object { $context.VideoExtensions -contains $_.Extension.ToLowerInvariant() } |
                Sort-Object FullName |
                ForEach-Object {
                    $relative = $_.FullName.Substring($context.VideoPrefix.Length).Replace('\', '/')
                    $encoded = (($relative.Split('/') | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/')
                    $parent = [IO.Path]::GetDirectoryName($relative)
                    $duration = [TubeKids.Media]::GetDurationSeconds($_.FullName)
                    [PSCustomObject]@{
                        id = "file:$relative"
                        src = '/__video/' + $encoded
                        thumb = '/__thumb/' + $encoded
                        duration = if ($duration -gt 0) { [Math]::Round($duration, 3) } else { $null }
                        title = [IO.Path]::GetFileNameWithoutExtension($_.Name)
                        category = if ($parent) { $parent.Split([char[]]@('/', '\'))[0] } else { 'סרטונים' }
                        folder = if ($parent) { $parent.Split([char[]]@('/', '\'))[0] } else { $null }
                    }
                })
            $json = [PSCustomObject]@{ folder = $context.VideoFolder; categories = $categories; videos = $videos } | ConvertTo-Json -Depth 4 -Compress
            Write-Body -Stream $stream -Status '200 OK' -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json)) -Extra "Cache-Control: no-store`r`n"
            return
        }

        if ($requestPath.StartsWith('/__category/', [StringComparison]::Ordinal)) {
            $categoryName = [Uri]::UnescapeDataString($requestPath.Substring(12))
            if ($categoryName.IndexOfAny([char[]]@('/', '\')) -ge 0) { Write-NotFound -Stream $stream; return }
            $categoryDirectory = Resolve-Inside -Root $context.VideoFolder -Prefix $context.VideoPrefix -Relative $categoryName
            $categoryImage = if ($categoryDirectory) { Join-Path $categoryDirectory 'category.jpg' } else { $null }
            if (-not $categoryImage -or -not (Test-Path -LiteralPath $categoryImage -PathType Leaf)) {
                Write-NotFound -Stream $stream; return
            }
            Write-Body -Stream $stream -Status '200 OK' -ContentType 'image/jpeg' -Body ([IO.File]::ReadAllBytes($categoryImage)) -Extra "Cache-Control: no-cache`r`nX-Content-Type-Options: nosniff`r`n"
            return
        }

        if ($requestPath.StartsWith('/__thumb/', [StringComparison]::Ordinal)) {
            $relative = [Uri]::UnescapeDataString($requestPath.Substring(9)).Replace('/', '\')
            $fullPath = Resolve-Inside -Root $context.VideoFolder -Prefix $context.VideoPrefix -Relative $relative
            if (-not $fullPath -or -not (Test-Path -LiteralPath $fullPath -PathType Leaf) -or
                $context.VideoExtensions -notcontains [IO.Path]::GetExtension($fullPath).ToLowerInvariant()) {
                Write-NotFound -Stream $stream; return
            }

            $basePath = Get-ThumbBasePath -Context $context -File (Get-Item -LiteralPath $fullPath)
            $thumbPath = "$basePath.jpg"
            $missPath = "$basePath.miss"
            if (-not (Test-Path -LiteralPath $thumbPath -PathType Leaf) -and -not (Test-Path -LiteralPath $missPath -PathType Leaf)) {
                # יצירה אחת בכל פעם: הקריאה ל־COM אינה מקבילית, והתוצאה נשמרת במטמון לתמיד
                [Threading.Monitor]::Enter($context.ThumbLock)
                try {
                    if (-not (Test-Path -LiteralPath $thumbPath -PathType Leaf)) {
                        if (-not [TubeKids.Media]::SaveThumbnail($fullPath, $thumbPath, 480, 270)) {
                            Set-Content -LiteralPath $missPath -Value '' -ErrorAction SilentlyContinue
                        }
                    }
                } finally { [Threading.Monitor]::Exit($context.ThumbLock) }
            }

            if (-not (Test-Path -LiteralPath $thumbPath -PathType Leaf)) { Write-NotFound -Stream $stream; return }
            Write-Body -Stream $stream -Status '200 OK' -ContentType 'image/jpeg' -Body ([IO.File]::ReadAllBytes($thumbPath)) -Extra "Cache-Control: max-age=3600`r`nX-Content-Type-Options: nosniff`r`n"
            return
        }

        if ($requestPath.StartsWith('/__video/', [StringComparison]::Ordinal)) {
            $relative = [Uri]::UnescapeDataString($requestPath.Substring(9)).Replace('/', '\')
            $fullPath = Resolve-Inside -Root $context.VideoFolder -Prefix $context.VideoPrefix -Relative $relative
            $extension = if ($fullPath) { [IO.Path]::GetExtension($fullPath).ToLowerInvariant() } else { '' }
            if (-not $fullPath -or -not (Test-Path -LiteralPath $fullPath -PathType Leaf) -or
                $context.VideoExtensions -notcontains $extension) {
                Write-NotFound -Stream $stream; return
            }

            $fileInfo = Get-Item -LiteralPath $fullPath
            [long]$start = 0
            [long]$end = $fileInfo.Length - 1
            $status = '200 OK'
            $contentRange = ''
            if ($headers.ContainsKey('range') -and $headers['range'] -match '^bytes=(\d*)-(\d*)') {
                if ($Matches[1]) { $start = [long]$Matches[1] }
                if ($Matches[2]) { $end = [Math]::Min([long]$Matches[2], $end) }
                if ($start -gt $end -or $start -ge $fileInfo.Length) {
                    $bytes = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 416 Range Not Satisfiable`r`nContent-Range: bytes */$($fileInfo.Length)`r`nConnection: close`r`n`r`n")
                    $stream.Write($bytes, 0, $bytes.Length)
                    return
                }
                $status = '206 Partial Content'
                $contentRange = "Content-Range: bytes $start-$end/$($fileInfo.Length)`r`n"
            }
            [long]$remaining = $end - $start + 1
            Write-Head -Stream $stream -Status $status -ContentType $context.MimeTypes[$extension] -Length $remaining -Extra ("Accept-Ranges: bytes`r`n" + $contentRange + "Cache-Control: no-cache`r`n")

            $fileStream = [IO.File]::OpenRead($fullPath)
            try {
                [void]$fileStream.Seek($start, [IO.SeekOrigin]::Begin)
                $buffer = New-Object byte[] 131072
                while ($remaining -gt 0) {
                    $read = $fileStream.Read($buffer, 0, [Math]::Min([long]$buffer.Length, $remaining))
                    if ($read -le 0) { break }
                    $stream.Write($buffer, 0, $read)
                    $remaining -= $read
                }
            } finally { $fileStream.Dispose() }
            return
        }

        $relativePath = [Uri]::UnescapeDataString($requestPath.TrimStart('/')).Replace('/', '\')
        if (-not $relativePath) { $relativePath = 'index.html' }
        $fullPath = Resolve-Inside -Root $context.ProjectRoot -Prefix $context.RootPrefix -Relative $relativePath
        if (-not $fullPath -or -not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
            Write-NotFound -Stream $stream; return
        }
        $extension = [IO.Path]::GetExtension($fullPath).ToLowerInvariant()
        $mime = if ($context.MimeTypes.ContainsKey($extension)) { $context.MimeTypes[$extension] } else { 'application/octet-stream' }
        Write-Body -Stream $stream -Status '200 OK' -ContentType $mime -Body ([IO.File]::ReadAllBytes($fullPath)) -Extra "Cache-Control: no-cache`r`nX-Content-Type-Options: nosniff`r`n"
    } catch {
        # חיבור שנקטע או נגן שהפסיק לקרוא לא צריכים להפיל את היישום
    } finally {
        try { $client.Close() } catch { }
    }
}

$pool = [RunspaceFactory]::CreateRunspacePool(1, $maxWorkers)
$pool.Open()
$inFlight = New-Object 'System.Collections.Generic.List[object]'

try {
    while (([DateTime]::UtcNow - $context.LastRequest).TotalSeconds -lt $idleTimeoutSeconds) {
        if (-not $listener.Pending()) {
            Start-Sleep -Milliseconds 25
        } else {
            $client = $listener.AcceptTcpClient()
            $worker = [PowerShell]::Create()
            $worker.RunspacePool = $pool
            [void]$worker.AddScript($handler.ToString()).AddArgument($context).AddArgument($client)
            $inFlight.Add([PSCustomObject]@{ Worker = $worker; Handle = $worker.BeginInvoke() })
        }

        for ($i = $inFlight.Count - 1; $i -ge 0; $i--) {
            if ($inFlight[$i].Handle.IsCompleted) {
                try { $inFlight[$i].Worker.EndInvoke($inFlight[$i].Handle) } catch { }
                $inFlight[$i].Worker.Dispose()
                $inFlight.RemoveAt($i)
            }
        }
    }
} finally {
    $listener.Stop()
    foreach ($entry in $inFlight) { try { $entry.Worker.Dispose() } catch { } }
    $pool.Close()
    $pool.Dispose()
}
