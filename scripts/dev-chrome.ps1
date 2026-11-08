# Launches a dedicated Chrome instance for development with remote debugging on port 9222.
# Separate user-data-dir: isolated from the real Chrome profiles.
$root = Split-Path $PSScriptRoot -Parent
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
Start-Process $chrome -ArgumentList "--user-data-dir=`"$root\.chrome-dev`"", "--remote-debugging-port=9222", "--no-first-run", "--no-default-browser-check", "https://mail.google.com"
