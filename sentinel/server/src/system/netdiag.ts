/**
 * Network diagnostics for the Xiaomi P2P (CS2) connection.
 *
 * How go2rtc connects (pkg/xiaomi/miss/cs2, v1.9.15): it opens a UDP socket on a random port,
 * sends a LAN-search packet to <camera-ip>:32108 and waits 5 s for the reply. The camera answers
 * from a DIFFERENT port, so a stateful firewall (Windows Defender Firewall) treats the reply as
 * unsolicited inbound traffic and drops it unless go2rtc has an inbound allow rule. The symptom is
 * "streams: read udp [::]:NNNNN: i/o timeout".
 */
import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { go2rtc } from '../go2rtc/client.js';
import { getSettings } from '../settings/store.js';

const run = promisify(execFile);
const isWin = process.platform === 'win32';

export interface LocalAddress {
  iface: string;
  address: string;
  netmask: string;
}

export interface CameraDiag {
  id: string;
  name: string;
  ip: string | null;
  sameSubnet: boolean | null;
  /** ICMP echo via the OS ping tool. null = could not run ping. Some devices ignore ping. */
  ping: boolean | null;
}

export interface FirewallInfo {
  /** Rules that apply to go2rtc's executable (null = could not read). */
  rules: Array<{ name: string; direction: string; action: string; enabled: boolean; profile: string }> | null;
  hasInboundAllow: boolean | null;
  hasInboundBlock: boolean | null;
  /** Network profiles of the active connections, e.g. Private / Public / DomainAuthenticated. */
  profiles: Array<{ name: string; category: string; iface: string }> | null;
}

export interface NetDiag {
  platform: NodeJS.Platform;
  go2rtcExe: string;
  local: LocalAddress[];
  cameras: CameraDiag[];
  firewall: FirewallInfo | null;
  findings: string[];
}

const toInt = (ip: string) => ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;

export function inSubnet(ip: string, local: LocalAddress): boolean {
  const mask = toInt(local.netmask);
  return (toInt(ip) & mask) === (toInt(local.address) & mask);
}

export function localAddresses(): LocalAddress[] {
  const out: LocalAddress[] = [];
  for (const [iface, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ iface, address: a.address, netmask: a.netmask });
    }
  }
  return out;
}

/** Camera IPs come from the go2rtc stream sources (xiaomi://<user>:<region>@<ip>?…). */
async function cameraIps(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const streams = (await go2rtc.streams()) ?? {};
    for (const [name, s] of Object.entries(streams)) {
      const url = s.producers?.[0]?.url ?? '';
      const m = /^xiaomi:\/\/[^@]*@((?:\d{1,3}\.){3}\d{1,3})/.exec(url);
      if (m) map.set(name, m[1]);
    }
  } catch {
    /* go2rtc down */
  }
  return map;
}

async function ping(ip: string): Promise<boolean | null> {
  const args =
    process.platform === 'win32' ? ['-n', '2', '-w', '1000', ip] : process.platform === 'darwin' ? ['-c', '2', '-W', '1000', ip] : ['-c', '2', '-W', '1', ip];
  try {
    await run('ping', args, { timeout: 6000, windowsHide: true });
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'ENOENT' ? null : false;
  }
}

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function powershellJson<T>(script: string): Promise<T | null> {
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 15000, windowsHide: true });
    const text = stdout.trim();
    if (!text) return [] as unknown as T;
    const v = JSON.parse(text);
    return (Array.isArray(v) ? v : [v]) as T;
  } catch {
    return null;
  }
}

async function windowsFirewall(): Promise<FirewallInfo> {
  const exe = psQuote(config.go2rtc.bin);
  const rules = await powershellJson<Array<{ DisplayName: string; Direction: number | string; Action: number | string; Enabled: number | string | boolean; Profile: number | string }>>(
    `Get-NetFirewallApplicationFilter -Program ${exe} -ErrorAction SilentlyContinue | Get-NetFirewallRule | ` +
      `Select-Object DisplayName,@{n='Direction';e={"$($_.Direction)"}},@{n='Action';e={"$($_.Action)"}},@{n='Enabled';e={"$($_.Enabled)"}},@{n='Profile';e={"$($_.Profile)"}} | ConvertTo-Json -Compress`,
  );
  const profiles = await powershellJson<Array<{ Name: string; NetworkCategory: string; InterfaceAlias: string }>>(
    `Get-NetConnectionProfile | Select-Object Name,@{n='NetworkCategory';e={"$($_.NetworkCategory)"}},InterfaceAlias | ConvertTo-Json -Compress`,
  );
  const mapped = rules?.map((r) => ({
    name: r.DisplayName,
    direction: String(r.Direction),
    action: String(r.Action),
    enabled: String(r.Enabled) === 'True' || r.Enabled === true,
    profile: String(r.Profile),
  })) ?? null;
  return {
    rules: mapped,
    hasInboundAllow: mapped ? mapped.some((r) => r.enabled && r.direction === 'Inbound' && r.action === 'Allow') : null,
    hasInboundBlock: mapped ? mapped.some((r) => r.enabled && r.direction === 'Inbound' && r.action === 'Block') : null,
    profiles: profiles?.map((p) => ({ name: p.Name, category: String(p.NetworkCategory), iface: p.InterfaceAlias })) ?? null,
  };
}

export async function runNetDiag(): Promise<NetDiag> {
  const local = localAddresses();
  const ips = await cameraIps();
  const cams = getSettings().cameras.filter((c) => c.enabled);

  const cameras: CameraDiag[] = await Promise.all(
    cams.map(async (c) => {
      const ip = ips.get(c.stream) ?? null;
      return {
        id: c.id,
        name: c.name,
        ip,
        sameSubnet: ip ? local.some((l) => inSubnet(ip, l)) : null,
        ping: ip ? await ping(ip) : null,
      };
    }),
  );
  const firewall = isWin ? await windowsFirewall() : null;

  // Plain-language findings, most decisive first.
  const findings: string[] = [];
  const withIp = cameras.filter((c) => c.ip);
  if (!local.length) findings.push('no-network');
  if (withIp.length && withIp.every((c) => c.sameSubnet === false)) findings.push('different-subnet');
  else if (withIp.some((c) => c.sameSubnet === false)) findings.push('some-different-subnet');
  if (withIp.length && withIp.every((c) => c.ping === false)) findings.push('no-ping');
  if (firewall) {
    if (firewall.hasInboundBlock) findings.push('firewall-block');
    if (firewall.hasInboundAllow === false) findings.push('firewall-no-allow');
    if (firewall.profiles?.some((p) => p.category === 'Public')) findings.push('network-public');
  }
  return { platform: process.platform, go2rtcExe: config.go2rtc.bin, local, cameras, firewall, findings };
}

/**
 * Windows only: one elevated PowerShell run (the user sees the UAC prompt) that
 *  - removes inbound BLOCK rules for go2rtc.exe (created when the firewall dialog was cancelled)
 *  - adds an inbound UDP allow rule for go2rtc.exe on Private/Domain networks only
 *  - optionally switches the given network interfaces from Public to Private
 * Nothing else is changed, and nothing is opened to the internet.
 */
export async function fixWindowsFirewall(makePrivate: string[] = [], lan = false): Promise<{ ok: boolean; error?: string }> {
  if (!isWin) return { ok: false, error: 'Windows only' };
  const exe = psQuote(config.go2rtc.bin);
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `$exe = ${exe}`,
    "Get-NetFirewallApplicationFilter -Program $exe -ErrorAction SilentlyContinue | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' } | Remove-NetFirewallRule",
    "Get-NetFirewallRule -DisplayName 'SENTINEL go2rtc (cameras)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule",
    "New-NetFirewallRule -DisplayName 'SENTINEL go2rtc (cameras)' -Description 'Lets Xiaomi cameras on the home network answer go2rtc (SENTINEL).' -Direction Inbound -Program $exe -Protocol UDP -Action Allow -Profile Private,Domain | Out-Null",
    ...(lan
      ? [
          // Phone access on the home network: the dashboard port (this app) and WebRTC media (go2rtc).
          "Get-NetFirewallRule -DisplayName 'SENTINEL dashboard (home network)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule",
          `New-NetFirewallRule -DisplayName 'SENTINEL dashboard (home network)' -Direction Inbound -Program ${psQuote(process.execPath)} -Protocol TCP -LocalPort ${config.port} -Action Allow -Profile Private | Out-Null`,
          "Get-NetFirewallRule -DisplayName 'SENTINEL go2rtc WebRTC (home network)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule",
          `New-NetFirewallRule -DisplayName 'SENTINEL go2rtc WebRTC (home network)' -Direction Inbound -Program $exe -Protocol TCP -LocalPort ${config.go2rtc.webrtcPort} -Action Allow -Profile Private | Out-Null`,
        ]
      : []),
    ...makePrivate.map((alias) => `Set-NetConnectionProfile -InterfaceAlias ${psQuote(alias)} -NetworkCategory Private`),
  ];
  const encoded = Buffer.from(lines.join('\n'), 'utf16le').toString('base64');
  const outer = `$p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded}'; exit $p.ExitCode`;
  try {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', outer], { timeout: 120000, windowsHide: true });
    return { ok: true };
  } catch (err) {
    const msg = String((err as Error).message ?? err);
    if (/cancel|canceled|operation was canceled|1223/i.test(msg)) return { ok: false, error: 'cancelled' };
    return { ok: false, error: 'failed' };
  }
}
