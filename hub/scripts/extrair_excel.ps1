# Extrai consultas do banco usando o Excel como conector: o Excel usa o login
# de banco que já está salvo nele (ninguém precisa saber a senha). Só leitura.
#
#   extrair_excel.ps1 -Spec consultas.json -Saida extracao.xlsx
#
# consultas.json: [{"nome": "aba", "m": "<código Power Query>"}, ...]
# Cada consulta vira uma aba da pasta de trabalho de saída. Pasta de trabalho
# nova, fora do OneDrive (o Excel via COM trava a sincronização do OneDrive).
# Sai com código 0 se tudo carregou; 1 se alguma consulta falhou.
param([Parameter(Mandatory)][string]$Spec, [Parameter(Mandatory)][string]$Saida)
$ErrorActionPreference = "Stop"
$consultas = Get-Content -LiteralPath $Spec -Raw -Encoding UTF8 | ConvertFrom-Json
$antes = @(Get-Process EXCEL -ErrorAction SilentlyContinue | ForEach-Object Id)
$xl = New-Object -ComObject Excel.Application
$meus = @(Get-Process EXCEL | Where-Object { $antes -notcontains $_.Id } | ForEach-Object Id)
$falhou = $false
try {
  $xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.ScreenUpdating = $false
  $wb = $xl.Workbooks.Add()
  $i = 0
  foreach ($c in $consultas) {
    $i++
    $ws = if ($i -le $wb.Worksheets.Count) { $wb.Worksheets.Item($i) } else { $wb.Worksheets.Add([Type]::Missing, $wb.Worksheets.Item($wb.Worksheets.Count)) }
    $ws.Name = $c.nome
    try {
      [void]$wb.Queries.Add($c.nome, $c.m)
      $conn = "OLEDB;Provider=Microsoft.Mashup.OleDb.1;Data Source=`$Workbook`$;Location=$($c.nome);Extended Properties=`"`""
      $lo = $ws.ListObjects.Add(0, $conn, $true, 1, $ws.Range("A1"))
      $lo.QueryTable.CommandType = 2
      $lo.QueryTable.CommandText = "SELECT * FROM [$($c.nome)]"
      $lo.QueryTable.BackgroundQuery = $false
      $t = Get-Date
      [void]$lo.QueryTable.Refresh($false)
      "ok`t$($c.nome)`t$($lo.ListRows.Count)`t{0:N0}s" -f ((Get-Date) - $t).TotalSeconds
    } catch {
      $falhou = $true
      "ERRO`t$($c.nome)`t$($_.Exception.Message)"
    }
  }
  $wb.SaveAs($Saida, 51)
  $wb.Close($false)
} finally {
  $xl.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
  Start-Sleep -Seconds 2
  $meus | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}
if ($falhou) { exit 1 }
