# Registers a Windows Scheduled Task that runs scripts/daily-sync.mjs once a
# day. Run this once, as Administrator, from the project root:
#
#   powershell -ExecutionPolicy Bypass -File scripts\register-daily-sync-task.ps1
#
# Adjust -At (time of day) and -TaskName as you like. The task runs even if
# no user is logged in, using the account that registers it — re-run
# Register-ScheduledTask with -User/-Password to run it as a specific
# service account instead.

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$NodeExe = (Get-Command node).Source
$ScriptPath = Join-Path $ProjectRoot "scripts\daily-sync.mjs"
$TaskName = "OrderPortal-DailySync"

$Action = New-ScheduledTaskAction -Execute $NodeExe -Argument "`"$ScriptPath`"" -WorkingDirectory $ProjectRoot
$Trigger = New-ScheduledTaskTrigger -Daily -At 3am
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Daily sync of SAP Customers/Items/Price Lists/Contract Discounts into the Order Portal's local MySQL cache" -Force

Write-Host "Registered scheduled task '$TaskName' to run daily at 3:00 AM."
Write-Host "View/edit it in Task Scheduler, or run: Get-ScheduledTask -TaskName '$TaskName'"
Write-Host "Run it immediately to test: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Logs are written to: $ProjectRoot\daily-sync.log"
