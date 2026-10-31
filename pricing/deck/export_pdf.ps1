# Exports the investor deck to PDF with PowerPoint (fonts and layout exactly as PowerPoint renders them).
param([string]$Deck = "$PSScriptRoot\..\Plotskart_Investor_Plan.pptx")
$deckPath = (Resolve-Path $Deck).Path
$pdfPath = [IO.Path]::ChangeExtension($deckPath, '.pdf')
$app = New-Object -ComObject PowerPoint.Application
try {
  $pres = $app.Presentations.Open($deckPath, $true, $false, $false)  # read-only, no title, no window
  $pres.SaveAs($pdfPath, 32)  # ppSaveAsPDF
  $pres.Close()
  Write-Output "saved $pdfPath"
} finally {
  $app.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
