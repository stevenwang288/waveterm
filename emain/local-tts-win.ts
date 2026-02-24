// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import child_process from "node:child_process";

export type BuiltinTtsRequest = {
    input: string;
    voice?: string;
    speed?: number;
};

function isWindows(): boolean {
    return process.platform === "win32";
}

function encodeUtf8ToBase64(value: string): string {
    return Buffer.from(value ?? "", "utf8").toString("base64");
}

function normalizeSpeed(speed: unknown): number {
    if (typeof speed !== "number" || Number.isNaN(speed) || !Number.isFinite(speed)) {
        return 1;
    }
    return Math.max(0.5, Math.min(2, speed));
}

function makePowerShellTtsScript(): string {
    // Keep output strictly to base64 WAV bytes to simplify parsing.
    // Uses System.Speech (built-in on Windows) and synthesizes to a MemoryStream.
    return [
        "$ErrorActionPreference = 'Stop'",
        "$ProgressPreference = 'SilentlyContinue'",
        "Add-Type -AssemblyName System.Speech",
        "$text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:WAVE_TTS_TEXT_B64))",
        "$voiceRaw = ''",
        "if ($env:WAVE_TTS_VOICE_B64 -and $env:WAVE_TTS_VOICE_B64.Trim() -ne '') {",
        "  try { $voiceRaw = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:WAVE_TTS_VOICE_B64)) } catch { $voiceRaw = '' }",
        "}",
        "$speed = 1.0",
        "if ($env:WAVE_TTS_SPEED -and $env:WAVE_TTS_SPEED.Trim() -ne '') {",
        "  try { $speed = [double]$env:WAVE_TTS_SPEED } catch { $speed = 1.0 }",
        "}",
        "$speed = [Math]::Max(0.5, [Math]::Min(2.0, $speed))",
        // Map speed (0.5..2.0) to synthesizer rate (-10..10).
        // 1.0 => 0, 0.5 => -3, 2.0 => +6 (clamped).
        "$rate = [int][Math]::Round(($speed - 1.0) * 6.0)",
        "$rate = [Math]::Max(-10, [Math]::Min(10, $rate))",
        "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer",
        "$synth.Rate = $rate",
        "if ($voiceRaw -and $voiceRaw.Trim() -ne '') {",
        "  $voice = $voiceRaw.Trim()",
        "  $culture = ''",
        // Common Wave voice strings look like 'zh-CN-XiaoxiaoNeural' => culture 'zh-CN'.
        "  if ($voice -match '^([a-zA-Z]{2}-[a-zA-Z]{2})') { $culture = $Matches[1] }",
        "  try {",
        "    $installed = @($synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo })",
        "    $selected = $null",
        "    if ($culture -ne '') {",
        "      $selected = $installed | Where-Object { $_.Culture -and $_.Culture.Name -eq $culture } | Select-Object -First 1",
        "    }",
        "    if (-not $selected) {",
        "      $selected = $installed | Where-Object { $_.Name -and ($_.Name -eq $voice -or $_.Name -like ('*' + $voice + '*')) } | Select-Object -First 1",
        "    }",
        "    if ($selected -and $selected.Name) { $synth.SelectVoice($selected.Name) }",
        "  } catch { }",
        "}",
        "$ms = New-Object System.IO.MemoryStream",
        "$synth.SetOutputToWaveStream($ms)",
        "$synth.Speak($text)",
        "$synth.Dispose()",
        "$bytes = $ms.ToArray()",
        "$ms.Dispose()",
        "[Convert]::ToBase64String($bytes)",
    ].join(";");
}

export async function synthesizeSpeechToWavBase64(req: BuiltinTtsRequest): Promise<string> {
    if (!isWindows()) {
        throw new Error("Builtin Windows TTS is not available on this platform.");
    }
    const input = (req?.input ?? "").trim();
    if (!input) {
        throw new Error("No text content to read.");
    }
    const voice = (req?.voice ?? "").trim();
    const speed = normalizeSpeed(req?.speed);

    const psScript = makePowerShellTtsScript();
    const env = {
        ...process.env,
        WAVE_TTS_TEXT_B64: encodeUtf8ToBase64(input),
        WAVE_TTS_VOICE_B64: voice ? encodeUtf8ToBase64(voice) : "",
        WAVE_TTS_SPEED: String(speed),
    };

    // Use powershell.exe (Windows-inbox) to avoid requiring pwsh.
    const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psScript];
    const stdout = await new Promise<string>((resolve, reject) => {
        child_process.execFile(
            "powershell.exe",
            args,
            { env, windowsHide: true, maxBuffer: 25 * 1024 * 1024 },
            (err, out, stderr) => {
                if (err) {
                    const details = (stderr || out || err.message || "").toString().trim();
                    reject(new Error(details || "Builtin Windows TTS failed."));
                    return;
                }
                resolve((out ?? "").toString().trim());
            }
        );
    });

    // Validate base64 quickly.
    if (!stdout) {
        throw new Error("Builtin Windows TTS returned empty audio.");
    }
    try {
        const bytes = Buffer.from(stdout, "base64");
        if (bytes.byteLength === 0) {
            throw new Error("empty");
        }
    } catch {
        throw new Error("Builtin Windows TTS returned invalid audio.");
    }
    return stdout;
}
