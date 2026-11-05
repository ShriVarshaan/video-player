# Opens the installer wizard, reads its first page, and closes it again. Nothing gets installed.
# Fails if the wizard offers an all-users install: Cinewall is per user, with no admin password.
#   powershell -NoProfile -File scripts/check-installer-pages.ps1 release\Cinewall-Setup-1.0.0.exe
param([Parameter(Mandatory = $true)][string]$Installer)

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$process = Start-Process -FilePath $Installer -PassThru
try {
  $texts = @()
  $end = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $end -and $texts.Count -lt 3) {
    Start-Sleep -Milliseconds 500
    $process.Refresh()
    if ($process.MainWindowHandle -eq [IntPtr]::Zero) { continue }
    $window = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
    $found = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $texts = @($found | ForEach-Object { $_.Current.Name } | Where-Object { $_ })
  }
  Write-Output "Wizard page says: $($texts -join ' | ')"
  if ($texts.Count -eq 0) { Write-Output 'FAILED: the wizard did not open'; exit 2 }
  if (($texts -join ' ') -match 'Anyone who uses this computer|Only for me') { Write-Output 'FAILED: the wizard offers an all-users install'; exit 1 }
  Write-Output 'OK: no all-users choice'
} finally {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
}
