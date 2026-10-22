# A window with a known title, for scripts/win32-smoke.mjs to find. It stays until the process is stopped.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = 'buddy-smoke-window'
# an ordinary window: it can be minimized (scripts/win32-minimize-check.mjs does) and is listed in the taskbar
$form.MinimizeBox = $true
$form.ShowInTaskbar = $true
$form.Width = 600
$form.Height = 400
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(200, 200)
[void]$form.ShowDialog()
