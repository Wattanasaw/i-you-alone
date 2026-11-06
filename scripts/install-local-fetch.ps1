# ตั้งเวลาให้เครื่องนี้ดึงงานอีเว้นท์วันละครั้ง 08:00 (หลังบอท GitHub รอบ 06:00)
# ถ้าเครื่องปิดอยู่ตอนถึงเวลา จะรันทันทีที่เปิดเครื่อง · ยกเลิก: Unregister-ScheduledTask -TaskName "I You Alone - ดึงงานอีเว้นท์"
$script = Join-Path $PSScriptRoot "local-fetch.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$triggers = @(New-ScheduledTaskTrigger -Daily -At 08:00)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName "I You Alone - ดึงงานอีเว้นท์" -Action $action -Trigger $triggers -Settings $settings -Description "ดึงงานจริงจาก Eventpop/Zipevent แล้วขึ้นเว็บ I You Alone" -Force | Out-Null
Write-Output "ตั้งเวลาแล้ว"
