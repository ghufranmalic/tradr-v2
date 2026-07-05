# Registers the KTrade sync-watcher to start automatically when you log into
# Windows, so it's always running in the background without manual restarts.
#
# Usage: run this once from an elevated PowerShell prompt, from the project folder:
#   powershell -ExecutionPolicy Bypass -File scripts\register-windows-task.ps1

$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $PSScriptRoot
$npmPath = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npmPath) {
  $npmPath = (Get-Command npm -ErrorAction Stop).Source
}

$taskName = "TradrSyncWatcher"
$action = New-ScheduledTaskAction -Execute $npmPath -Argument "run sync-watcher" -WorkingDirectory $projectDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Runs the Tradr KTrade collector locally so logins come from this PC's network." | Out-Null

Write-Host "Registered scheduled task '$taskName'. It will start automatically at your next login."
Write-Host "To start it right now: Start-ScheduledTask -TaskName $taskName"
Write-Host "To check status: Get-ScheduledTask -TaskName $taskName | Get-ScheduledTaskInfo"
Write-Host "To remove it later: Unregister-ScheduledTask -TaskName $taskName -Confirm:`$false"
