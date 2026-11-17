# The offline speech recogniser — the app's own voice input on Windows.
#
# It reads a 16 kHz mono 16-bit PCM WAV file and prints ONE JSON line:
#   { "ok": true,  "text": "the words it heard" }
#   { "ok": false, "message": "why it failed" }
#
# It runs entirely ON this computer: no cloud, no API key, no network. That is
# why the voice input needs no key at all.
param(
  [Parameter(Mandatory = $true)][string]$Wav
)

$ErrorActionPreference = 'Stop'
$result = $null

try {
  Add-Type -AssemblyName System.Speech

  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  try {
    $grammar = New-Object System.Speech.Recognition.DictationGrammar
    $engine.LoadGrammar($grammar)
    $engine.SetInputToWaveFile($Wav)

    $words = New-Object System.Collections.Generic.List[string]
    while ($true) {
      $recognized = $null
      try {
        $recognized = $engine.Recognize()
      }
      catch [System.Speech.SpeechRecognitionEngineException] {
        # The clip ended — the recogniser has no more audio to read. That is
        # the normal end of a recording, not a failure.
        break
      }
      if ($null -eq $recognized) { break }
      $text = $recognized.Text
      if (-not [string]::IsNullOrWhiteSpace($text)) { $words.Add($text.Trim()) }
    }
    $result = @{ ok = $true; text = ($words -join ' ').Trim() }
  }
  finally {
    $engine.Dispose()
  }
}
catch {
  $result = @{ ok = $false; message = $_.Exception.Message }
}

# ONE line on stdout — the app parses it as JSON.
[Console]::Out.Write(($result | ConvertTo-Json -Compress))
[Console]::Out.Write("`n")
if (-not $result.ok) { exit 1 }
exit 0
