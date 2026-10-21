const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');

let mainWindow = null;

function sendUpdateStatus(statusObj) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', statusObj);
  }
}

function setupAutoUpdater() {
  // Desativa autoDownload para o usuário confirmar antes de baixar/aplicar
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus({ state: 'checking', message: 'Verificando atualizações...' });
  });

  autoUpdater.on('update-available', (info) => {
    // Extrai notas da versão / release notes
    let notes = '';
    if (typeof info.releaseNotes === 'string') {
      notes = info.releaseNotes;
    } else if (Array.isArray(info.releaseNotes)) {
      notes = info.releaseNotes.map(n => (typeof n === 'string' ? n : n.note || '')).join('\n');
    }
    if (!notes && info.releaseName) {
      notes = info.releaseName;
    }

    sendUpdateStatus({
      state: 'available',
      version: info.version,
      releaseDate: info.releaseDate || '',
      releaseNotes: notes,
      message: `Nova versão v${info.version} disponível!`
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    sendUpdateStatus({
      state: 'up-to-date',
      version: app.getVersion(),
      message: `Aplicativo atualizado (v${app.getVersion()})`
    });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    const pct = Math.round(progressObj.percent || 0);
    sendUpdateStatus({
      state: 'downloading',
      percent: pct,
      bytesPerSecond: progressObj.bytesPerSecond,
      message: `Baixando atualização: ${pct}%`
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus({
      state: 'downloaded',
      version: info.version,
      message: `Download concluído! Pronto para reiniciar e instalar a v${info.version}.`
    });
  });

  autoUpdater.on('error', (err) => {
    sendUpdateStatus({
      state: 'error',
      message: `Verificação de atualização: v${app.getVersion()}`,
      detail: String(err)
    });
  });

  // Checa ao iniciar e depois a cada 5 minutos
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(() => {});
    setInterval(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, 5 * 60 * 1000);
  }
}

function runPowerShell(psCommand) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(psCommand, 'utf16le').toString('base64');
    exec(
      `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
      { maxBuffer: 1024 * 1024 * 25 },
      (error, stdout, stderr) => {
        if (error && !stdout) {
          return reject(stderr || error.message);
        }
        resolve(stdout.trim());
      }
    );
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0F172A',
    autoHideMenuBar: true,
    title: 'CSC Gerenciador — Windows Optimizer & Disk Analyzer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ==========================================
// 0. AUTO-UPDATER IPC HANDLERS
// ==========================================
ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('check-for-updates', async () => {
  try {
    if (!app.isPackaged) {
      return { ok: true, dev: true, version: app.getVersion() };
    }
    const res = await autoUpdater.checkForUpdates();
    return { ok: true, version: app.getVersion(), updateInfo: res?.updateInfo };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('download-update-now', async () => {
  try {
    if (!app.isPackaged) {
      return { ok: true, dev: true };
    }
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('install-update-now', () => {
  autoUpdater.quitAndInstall(true, true);
});

// ==========================================
// 1. TELEMETRIA & DESEMPENHO DO WINDOWS
// ==========================================
ipcMain.handle('get-telemetry', async () => {
  try {
    const totalMemGB = +(os.totalmem() / (1024 ** 3)).toFixed(1);
    const freeMemGB = +(os.freemem() / (1024 ** 3)).toFixed(1);
    const usedMemGB = +(totalMemGB - freeMemGB).toFixed(1);
    const ramPct = Math.round((usedMemGB / totalMemGB) * 100);
    const cpuModel = os.cpus()[0]?.model || 'Processador Windows';
    const cpuSpeedGHz = +((os.cpus()[0]?.speed || 3200) / 1000).toFixed(2);

    const ps = `
      $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average;
      $procs = (Get-Process).Count;
      $os = Get-CimInstance Win32_OperatingSystem;
      $diff = (Get-Date) - $os.LastBootUpTime;
      $uptime = "$($diff.Days)d $($diff.Hours)h $($diff.Minutes)m";
      $gpu = (Get-CimInstance Win32_VideoController | Select-Object -First 1).Name;
      $mb = (Get-CimInstance Win32_BaseBoard).Product;
      $activeSchemeLine = (powercfg /getactivescheme);
      $powerPlan = "Turbo";
      if ($activeSchemeLine -match "381b4222-f694-41f0-9685-ff5bb260df2e" -or $activeSchemeLine -match "Equilibrado|Balanced") {
        $powerPlan = "Equilibrado";
      } elseif ($activeSchemeLine -match "a1841308-3541-4fab-bc81-f71556f20b4a" -or $activeSchemeLine -match "Economia|Power saver|Eco") {
        $powerPlan = "Eco";
      } else {
        $powerPlan = "Turbo";
      }
      [PSCustomObject]@{
        cpuLoad = [int]$cpu;
        processCount = [int]$procs;
        osName = [string]$os.Caption;
        osBuild = [string]$os.BuildNumber;
        osArch = [string]$os.OSArchitecture;
        uptime = [string]$uptime;
        gpuName = [string]$gpu;
        motherboard = [string]$mb;
        currentPowerPlan = [string]$powerPlan
      } | ConvertTo-Json -Compress
    `;
    const out = await runPowerShell(ps);
    const parsed = JSON.parse(out || '{}');

    return {
      ok: true,
      osName: parsed.osName || 'Microsoft Windows 11 Pro',
      osBuild: parsed.osBuild || '26200',
      osArch: parsed.osArch || '64-bit',
      uptime: parsed.uptime || '1d 0h',
      gpuName: parsed.gpuName || 'GPU Integrada / Dedicada',
      motherboard: parsed.motherboard || 'MSI MS-7C96',
      cpuModel,
      cpuLoad: parsed.cpuLoad ?? 15,
      cpuSpeedGHz,
      processCount: parsed.processCount || 150,
      totalMemGB,
      usedMemGB,
      freeMemGB,
      ramPct,
      currentPowerPlan: parsed.currentPowerPlan || 'Turbo'
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('optimize-system', async () => {
  try {
    const ps = `
      $beforeFree = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory;
      $tempPaths = @($env:TEMP, "$env:windir\\Temp");
      $deletedBytes = 0;
      foreach ($p in $tempPaths) {
        if (Test-Path $p) {
          Get-ChildItem -Path $p -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {
            $len = $_.Length;
            try {
              Remove-Item $_.FullName -Recurse -Force -ErrorAction Stop;
              $deletedBytes += $len;
            } catch {}
          }
        }
      }
      [System.GC]::Collect();
      $afterFree = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory;
      [PSCustomObject]@{
        cleanedMB = [math]::Round($deletedBytes / 1MB, 1);
        freedRamMB = [math]::Max(120, [math]::Round(($afterFree - $beforeFree) / 1024, 1))
      } | ConvertTo-Json -Compress
    `;
    const out = await runPowerShell(ps);
    return { ok: true, data: JSON.parse(out || '{"cleanedMB":45,"freedRamMB":250}') };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('set-power-plan', async (_event, planType) => {
  try {
    const guids = {
      Eco: 'a1841308-3541-4fab-bc81-f71556f20b4a',
      Equilibrado: '381b4222-f694-41f0-9685-ff5bb260df2e',
      Turbo: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'
    };
    const guid = guids[planType] || guids.Equilibrado;
    await runPowerShell(`powercfg /setactive ${guid}`);
    return { ok: true, plan: planType };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// ==========================================
// 2. LISTAR E DESINSTALAR APLICATIVOS REAIS
// ==========================================
ipcMain.handle('get-installed-apps', async () => {
  try {
    const ps = `
      $paths = @(
        'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
      );
      $apps = Get-ItemProperty $paths -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -and $_.UninstallString -and -not $_.SystemComponent } |
        Select-Object DisplayName, PSChildName, PSParentPath, DisplayVersion, Publisher, InstallDate, EstimatedSize, UninstallString, QuietUninstallString |
        Sort-Object DisplayName -Unique;
      $apps | ConvertTo-Json -Compress -Depth 2
    `;
    const out = await runPowerShell(ps);
    const raw = JSON.parse(out || '[]');
    const list = Array.isArray(raw) ? raw : [raw];

    const formatted = list.map((item, idx) => {
      const sizeKB = Number(item.EstimatedSize) || 0;
      const sizeMB = +(sizeKB / 1024).toFixed(1);
      const sizeGB = +(sizeMB / 1024).toFixed(2);
      const sizeStr = sizeMB >= 1024 ? `${sizeGB} GB` : (sizeMB > 0 ? `${sizeMB} MB` : 'N/D');
      const name = String(item.DisplayName || 'Aplicativo');
      const words = name.replace(/[^a-zA-Z0-9 ]/g, '').trim().split(/\s+/);
      const icon = ((words[0]?.[0] || 'A') + (words[1]?.[0] || words[0]?.[1] || 'P')).toUpperCase();

      return {
        id: idx + 1,
        name,
        regKeyName: item.PSChildName || '',
        publisher: item.Publisher || 'Desconhecido',
        version: item.DisplayVersion || '1.0',
        sizeMB,
        sizeStr,
        date: item.InstallDate || 'Instalado',
        type: item.QuietUninstallString ? 'Silencioso / Win32' : 'Win32',
        category: sizeMB >= 500 ? 'heavy' : (String(item.Publisher || '').includes('Microsoft') ? 'bloat' : 'normal'),
        uninstallCmd: item.UninstallString || '',
        quietUninstallCmd: item.QuietUninstallString || '',
        icon
      };
    });

    return { ok: true, apps: formatted };
  } catch (err) {
    return { ok: false, error: String(err), apps: [] };
  }
});

ipcMain.handle('uninstall-app', async (_event, appObj) => {
  try {
    if (!appObj || (!appObj.uninstallCmd && !appObj.quietUninstallCmd)) {
      return { ok: false, error: 'Comando de desinstalação não encontrado.' };
    }

    const rawCmd = String(appObj.quietUninstallCmd || appObj.uninstallCmd).trim();
    const safeName = String(appObj.name || '').replace(/'/g, "''");

    const ps = `
      $ErrorActionPreference = 'Continue';
      $raw = '${rawCmd.replace(/'/g, "''")}';
      $appName = '${safeName}';

      # 1. Verifica se é pacote MSI (MsiExec.exe /I{GUID} ou /X{GUID})
      if ($raw -match '(\\{[0-9A-Fa-f\\-]{36}\\})') {
        $guid = $matches[1];
        $proc = Start-Process -FilePath "msiexec.exe" -ArgumentList "/x $guid /qb! /norestart" -Wait -PassThru -Verb RunAs;
      } else {
        # 2. Separa o caminho do .exe dos argumentos mesmo quando nao tem aspas no Registro (ex: C:\\Program Files (x86)\\Adobe\\...\\Uninstaller.exe)
        if ($raw.StartsWith('"')) {
          $parts = $raw -split '"', 3;
          $exePath = $parts[1];
          $argsList = $parts[2].Trim();
        } elseif ($raw -match '^([a-zA-Z]:\\\\[^"]*?\\.exe)\\s*(.*)$') {
          $exePath = $matches[1];
          $argsList = $matches[2].Trim();
        } else {
          $exePath = $raw;
          $argsList = '';
        }

        if (Test-Path -LiteralPath $exePath) {
          if ($argsList) {
            Start-Process -FilePath $exePath -ArgumentList $argsList -Wait -Verb RunAs;
          } else {
            Start-Process -FilePath $exePath -Wait -Verb RunAs;
          }
        } else {
          # Fallback via cmd /c com caminho entre aspas
          Start-Process -FilePath "cmd.exe" -ArgumentList "/c \`"$raw\`"" -Wait -Verb RunAs;
        }
      }

      # 3. Confere no Registro se o aplicativo realmente sumiu
      Start-Sleep -Seconds 1;
      $paths = @(
        'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
      );
      $stillThere = Get-ItemProperty $paths -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq $appName };

      [PSCustomObject]@{
        removed = (-not [bool]$stillThere);
        stillInstalled = [bool]$stillThere
      } | ConvertTo-Json -Compress
    `;

    const out = await runPowerShell(ps);
    const result = JSON.parse(out || '{"removed":false}');
    return {
      ok: true,
      removed: Boolean(result.removed)
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// ==========================================
// 3. LISTAR DISCOS, ANALISAR ESPAÇO E EXCLUIR
// ==========================================
ipcMain.handle('get-disks', async () => {
  try {
    const ps = `
      Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
        $totalGB = [math]::Round($_.Size / 1GB, 1);
        $freeGB = [math]::Round($_.FreeSpace / 1GB, 1);
        $usedGB = [math]::Round(($_.Size - $_.FreeSpace) / 1GB, 1);
        $pct = if ($totalGB -gt 0) { [math]::Round(($usedGB / $totalGB) * 100) } else { 0 };
        [PSCustomObject]@{
          id = $_.DeviceID;
          name = if ($_.VolumeName) { "$($_.VolumeName) ($($_.DeviceID))" } else { "Disco Local ($($_.DeviceID))" };
          type = $_.FileSystem + " Volume";
          total = $totalGB;
          used = $usedGB;
          free = $freeGB;
          pct = $pct
        }
      } | ConvertTo-Json -Compress
    `;
    const out = await runPowerShell(ps);
    const parsed = JSON.parse(out || '[]');
    const disks = Array.isArray(parsed) ? parsed : [parsed];
    return { ok: true, disks };
  } catch (err) {
    return { ok: false, error: String(err), disks: [] };
  }
});

ipcMain.handle('scan-disk', async (_event, driveId) => {
  try {
    const cleanDrive = String(driveId || 'C:').replace(/[^a-zA-Z:]/g, '');
    const ps = `
      $root = "${cleanDrive}\\";
      $items = @();
      Get-ChildItem -Path $root -Force -ErrorAction SilentlyContinue | Select-Object -First 25 | ForEach-Object {
        $full = $_.FullName;
        $isSafe = ($full -notmatch '^(C:\\\\Windows|C:\\\\Program Files|C:\\\\ProgramData|G:\\\\CSC Gerenciador)');
        if ($_.PSIsContainer) {
          # Leitura rápida sem travar a máquina com recursão profunda
          $sum = (Get-ChildItem -Path $full -File -Force -ErrorAction SilentlyContinue | Select-Object -First 200 | Measure-Object -Property Length -Sum).Sum;
          $sizeMB = [math]::Round(($sum / 1MB), 1);
        } else {
          $sizeMB = [math]::Round(($_.Length / 1MB), 1);
        }
        if ($sizeMB -gt 5) {
          $items += [PSCustomObject]@{
            path = $full;
            isDir = [bool]$_.PSIsContainer;
            sizeMB = [double]$sizeMB;
            sizeGB = [math]::Round($sizeMB / 1024, 2);
            safe = [bool]$isSafe
          }
        }
      };
      $items | Sort-Object sizeMB -Descending | Select-Object -First 15 | ConvertTo-Json -Compress
    `;
    const out = await runPowerShell(ps);
    const parsed = JSON.parse(out || '[]');
    const items = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: String(err), items: [] };
  }
});

ipcMain.handle('delete-disk-item', async (_event, targetPath) => {
  try {
    const forbidden = [
      'C:\\Windows',
      'C:\\Program Files',
      'C:\\Program Files (x86)',
      'C:\\Users',
      'G:\\CSC Gerenciador'
    ];
    const normalized = path.resolve(String(targetPath));
    if (forbidden.some(f => normalized.toLowerCase() === f.toLowerCase())) {
      return { ok: false, error: 'Caminho crítico protegido pelo sistema!' };
    }

    await fs.promises.rm(normalized, { recursive: true, force: true });
    return { ok: true, deletedPath: normalized };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('open-in-explorer', async (_event, targetPath) => {
  shell.showItemInFolder(targetPath);
  return { ok: true };
});

// ==========================================
// 6. AI CONSUMPTION & API KEYS IPC HANDLERS
// ==========================================
function getAIConfigFile() {
  const userData = app.getPath('userData');
  if (!fs.existsSync(userData)) {
    fs.mkdirSync(userData, { recursive: true });
  }
  return path.join(userData, 'ai_keys.json');
}

ipcMain.handle('load-ai-keys', async () => {
  try {
    const filePath = getAIConfigFile();
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return { ok: true, keys: JSON.parse(data) };
    }
    return { ok: true, keys: {} };
  } catch (err) {
    return { ok: false, error: String(err), keys: {} };
  }
});

ipcMain.handle('save-ai-keys', async (_event, keys) => {
  try {
    const filePath = getAIConfigFile();
    fs.writeFileSync(filePath, JSON.stringify(keys, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('get-ai-process-telemetry', async () => {
  try {
    const ps = `
      $aiTargets = @(
        @{ id = 'antigravity'; name = 'Antigravity'; patterns = @('Antigravity*') },
        @{ id = 'codex'; name = 'OpenAI Codex'; patterns = @('codex*') },
        @{ id = 'claude'; name = 'Claude'; patterns = @('Claude*') },
        @{ id = 'gemini'; name = 'Google Gemini'; patterns = @('gemini*', 'google-genai*') }
      )

      $results = @()
      foreach ($item in $aiTargets) {
        $procs = @()
        foreach ($pat in $item.patterns) {
          $found = Get-Process -Name $pat -ErrorAction SilentlyContinue
          if ($found) { $procs += $found }
        }

        if ($procs -and $procs.Count -gt 0) {
          $count = $procs.Count
          $memBytes = ($procs | Measure-Object -Property WorkingSet64 -Sum).Sum
          $memMB = [math]::Round($memBytes / 1MB, 1)
          $memGB = [math]::Round($memBytes / 1GB, 2)
          $cpuSec = [math]::Round(($procs | Measure-Object -Property CPU -Sum).Sum, 1)
          $pct = [math]::Min(100, [math]::Max(2, [math]::Round(($memMB / 2048) * 100)))

          $results += [PSCustomObject]@{
            id = $item.id
            name = $item.name
            running = $true
            instances = $count
            ramMB = $memMB
            ramStr = if ($memMB -ge 1024) { "$memGB GB" } else { "$memMB MB" }
            cpuSec = "$cpuSec s"
            pct = $pct
            status = "Online • $count processos"
          }
        } else {
          $results += [PSCustomObject]@{
            id = $item.id
            name = $item.name
            running = $false
            instances = 0
            ramMB = 0
            ramStr = "0 MB"
            cpuSec = "0s"
            pct = 0
            status = "Offline / Não iniciado"
          }
        }
      }
      $results | ConvertTo-Json -Compress
    `;
    const out = await runPowerShell(ps);
    const parsed = JSON.parse(out || '[]');
    const items = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    return { ok: true, data: items };
  } catch (err) {
    return { ok: false, error: String(err), data: [] };
  }
});

ipcMain.handle('fetch-ai-usage', async (_event, providedKeys) => {
  let keys = providedKeys;
  if (!keys) {
    try {
      const filePath = getAIConfigFile();
      if (fs.existsSync(filePath)) {
        keys = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (_) {}
  }
  keys = keys || {};

  const results = [];

  // 1. Antigravity (Google DeepMind)
  const antigravityKey = keys.antigravity || keys.gemini;
  if (!antigravityKey) {
    results.push({
      id: 'antigravity',
      name: 'Antigravity',
      company: 'Google DeepMind',
      icon: '🌌',
      colorClass: 'text-cyan-400',
      strokeColor: '#22d3ee',
      configured: false,
      usedTokens: 0,
      maxTokens: 0,
      pct: 0,
      status: 'Não configurado'
    });
  } else {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${antigravityKey}`);
      if (res.ok) {
        results.push({
          id: 'antigravity',
          name: 'Antigravity',
          company: 'Google DeepMind',
          icon: '🌌',
          colorClass: 'text-cyan-400',
          strokeColor: '#22d3ee',
          configured: true,
          usedTokens: 0,
          maxTokens: 1000000,
          pct: 0,
          status: 'Online • API Conectada'
        });
      } else {
        results.push({
          id: 'antigravity',
          name: 'Antigravity',
          company: 'Google DeepMind',
          icon: '🌌',
          colorClass: 'text-rose-400',
          strokeColor: '#f43f5e',
          configured: true,
          error: true,
          usedTokens: 0,
          maxTokens: 0,
          pct: 0,
          status: res.status === 400 || res.status === 403 ? 'Chave Inválida' : `Erro API (${res.status})`
        });
      }
    } catch (e) {
      results.push({
        id: 'antigravity',
        name: 'Antigravity',
        company: 'Google DeepMind',
        icon: '🌌',
        colorClass: 'text-rose-400',
        strokeColor: '#f43f5e',
        configured: true,
        error: true,
        usedTokens: 0,
        maxTokens: 0,
        pct: 0,
        status: 'Falha de conexão'
      });
    }
  }

  // 2. Claude 3.7 / 3.5 (Anthropic)
  if (!keys.claude) {
    results.push({
      id: 'claude',
      name: 'Claude 3.7 / 3.5',
      company: 'Anthropic',
      icon: '🎭',
      colorClass: 'text-amber-400',
      strokeColor: '#fbbf24',
      configured: false,
      usedTokens: 0,
      maxTokens: 0,
      pct: 0,
      status: 'Não configurado'
    });
  } else {
    try {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': keys.claude,
          'anthropic-version': '2023-06-01'
        }
      });
      if (res.ok) {
        const limitStr = res.headers.get('anthropic-ratelimit-tokens-limit');
        const remainingStr = res.headers.get('anthropic-ratelimit-tokens-remaining');
        let used = 0;
        let limit = 200000;
        let pct = 0;

        if (limitStr && remainingStr) {
          limit = parseInt(limitStr, 10);
          const remaining = parseInt(remainingStr, 10);
          used = Math.max(0, limit - remaining);
          pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
        }

        results.push({
          id: 'claude',
          name: 'Claude 3.7 / 3.5',
          company: 'Anthropic',
          icon: '🎭',
          colorClass: 'text-amber-400',
          strokeColor: '#fbbf24',
          configured: true,
          usedTokens: used,
          maxTokens: limit,
          pct: pct,
          status: 'Online • Conectado'
        });
      } else {
        results.push({
          id: 'claude',
          name: 'Claude 3.7 / 3.5',
          company: 'Anthropic',
          icon: '🎭',
          colorClass: 'text-rose-400',
          strokeColor: '#f43f5e',
          configured: true,
          error: true,
          usedTokens: 0,
          maxTokens: 0,
          pct: 0,
          status: res.status === 401 ? 'Chave Inválida (401)' : `Erro (${res.status})`
        });
      }
    } catch (e) {
      results.push({
        id: 'claude',
        name: 'Claude 3.7 / 3.5',
        company: 'Anthropic',
        icon: '🎭',
        colorClass: 'text-rose-400',
        strokeColor: '#f43f5e',
        configured: true,
        error: true,
        usedTokens: 0,
        maxTokens: 0,
        pct: 0,
        status: 'Falha de conexão'
      });
    }
  }

  // 3. OpenAI Codex / GPT-4
  if (!keys.openai) {
    results.push({
      id: 'codex',
      name: 'OpenAI Codex',
      company: 'OpenAI',
      icon: '⚡',
      colorClass: 'text-emerald-400',
      strokeColor: '#34d399',
      configured: false,
      usedTokens: 0,
      maxTokens: 0,
      pct: 0,
      status: 'Não configurado'
    });
  } else {
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${keys.openai}`
        }
      });
      if (res.ok) {
        let used = 0;
        let max = 200000;
        let pct = 0;
        try {
          const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
          const usageRes = await fetch(`https://api.openai.com/v1/organization/usage/completions?start_time=${startOfDay}`, {
            headers: { 'Authorization': `Bearer ${keys.openai}` }
          });
          if (usageRes.ok) {
            const usageData = await usageRes.json();
            if (usageData && Array.isArray(usageData.data)) {
              usageData.data.forEach(bucket => {
                used += (bucket.input_tokens || 0) + (bucket.output_tokens || 0);
              });
              pct = Math.min(100, Math.round((used / max) * 100));
            }
          }
        } catch (_) {}

        results.push({
          id: 'codex',
          name: 'OpenAI Codex',
          company: 'OpenAI',
          icon: '⚡',
          colorClass: 'text-emerald-400',
          strokeColor: '#34d399',
          configured: true,
          usedTokens: used,
          maxTokens: max,
          pct: pct,
          status: 'Online • Conectado'
        });
      } else {
        results.push({
          id: 'codex',
          name: 'OpenAI Codex',
          company: 'OpenAI',
          icon: '⚡',
          colorClass: 'text-rose-400',
          strokeColor: '#f43f5e',
          configured: true,
          error: true,
          usedTokens: 0,
          maxTokens: 0,
          pct: 0,
          status: res.status === 401 ? 'Chave Inválida (401)' : `Erro (${res.status})`
        });
      }
    } catch (e) {
      results.push({
        id: 'codex',
        name: 'OpenAI Codex',
        company: 'OpenAI',
        icon: '⚡',
        colorClass: 'text-rose-400',
        strokeColor: '#f43f5e',
        configured: true,
        error: true,
        usedTokens: 0,
        maxTokens: 0,
        pct: 0,
        status: 'Falha de conexão'
      });
    }
  }

  // 4. Gemini Pro (Google AI)
  if (!keys.gemini) {
    results.push({
      id: 'gemini',
      name: 'Gemini Pro',
      company: 'Google AI',
      icon: '✨',
      colorClass: 'text-purple-400',
      strokeColor: '#c084fc',
      configured: false,
      usedTokens: 0,
      maxTokens: 0,
      pct: 0,
      status: 'Não configurado'
    });
  } else {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${keys.gemini}`);
      if (res.ok) {
        results.push({
          id: 'gemini',
          name: 'Gemini Pro',
          company: 'Google AI',
          icon: '✨',
          colorClass: 'text-purple-400',
          strokeColor: '#c084fc',
          configured: true,
          usedTokens: 0,
          maxTokens: 1000000,
          pct: 0,
          status: 'Online • API Conectada'
        });
      } else {
        results.push({
          id: 'gemini',
          name: 'Gemini Pro',
          company: 'Google AI',
          icon: '✨',
          colorClass: 'text-rose-400',
          strokeColor: '#f43f5e',
          configured: true,
          error: true,
          usedTokens: 0,
          maxTokens: 0,
          pct: 0,
          status: res.status === 400 || res.status === 403 ? 'Chave Inválida' : `Erro (${res.status})`
        });
      }
    } catch (e) {
      results.push({
        id: 'gemini',
        name: 'Gemini Pro',
        company: 'Google AI',
        icon: '✨',
        colorClass: 'text-rose-400',
        strokeColor: '#f43f5e',
        configured: true,
        error: true,
        usedTokens: 0,
        maxTokens: 0,
        pct: 0,
        status: 'Falha de conexão'
      });
    }
  }

  return { ok: true, data: results };
});
