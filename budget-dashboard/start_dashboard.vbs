' Corre start_dashboard.ps1 sem nenhuma janela (o PowerShell, mesmo com -WindowStyle Hidden, mostra a
' consola por um instante). Usado pela tarefa "Dashboard Budgets (manter ligado)" do Agendador de Tarefas.
Dim dir
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\start_dashboard.ps1""", 0, False
