# Windows development handoff

Status: development setup plan, not Windows platform acceptance. Phase 31 executor
locking has only been executed on macOS/APFS x64. Keep Phase 12 execution unchanged.
No Tauri/Electron work is authorized until core completion gates pass.

## Environment

Use a local fixed NTFS drive, outside OneDrive/Dropbox or network shares. Use a
short path such as C:\\src\\nodus; preserve vaults separately from test fixtures.
Install Node 24.22.2 x64 (the currently tested macOS version; node-gyp 13 requires
Node ^24.15.0 or another supported major). package.json's >=24.0.0 declaration
is broader than this native build requirement; do not interpret it as qualification.
Use pnpm 11.9.0 from packageManager via Corepack 0.36.0, Python 3.12+ supported
by node-gyp, and Visual Studio 2022 Build Tools with Desktop development with C++,
MSVC x64/x86 tools and a Windows SDK. Match compiler architecture to Node.

Follow the official [node-gyp Windows prerequisites](https://github.com/nodejs/node-gyp#on-windows).
The [LockFileEx contract](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex)
permits byte-range locking beyond EOF and releases locks on process termination;
release timing still requires tests rather than a fixed-delay assumption.

## Clean clone and commands (PowerShell)

Only clone after the requested branch/commits have been published. Local ignored
state and preservation snapshots do not travel through Git. Do not copy macOS
node_modules, dist, or native binaries.

```powershell
node --version
node -p "process.platform + ' ' + process.arch"
py -3 --version
corepack --version
corepack pnpm --version  # must resolve 11.9.0 for this repository
Get-Volume | Select-Object DriveLetter, FileSystem, DriveType
corepack pnpm install --frozen-lockfile
corepack pnpm exec playwright install chromium
corepack pnpm run test:executor-lock
corepack pnpm run typecheck
corepack pnpm run build
corepack pnpm exec vitest run --maxWorkers=1
node scripts/browser-smoke.mjs
node scripts/conflict-ui-smoke.mjs
node scripts/combined-conflicts-navigation-smoke.mjs
node scripts/connections-sheet-smoke.mjs
node scripts/phase32-mobile-smoke.mjs
node scripts/search-smoke.mjs
node scripts/workspace-customization-smoke.mjs
node scripts/database-views-smoke.mjs
node scripts/landing-visual-smoke.mjs
git diff --check
git status --short
```

If Corepack is absent, install the approved Corepack version separately before
running these commands. If Python autodetection fails, set npm_config_python to
an actual verified python.exe path. Do not weaken tests to obtain a pass.

## Mandatory native qualification

Build and run on native Windows/NTFS x64, not WSL. Record OS, Node, compiler,
Python, architecture, drive type, filesystem and exact command outcomes. Require:
independent process contention, termination/reacquisition, noninheritance, duplicate
release, lifecycle/drain behavior, native identity and cleanup diagnostics,
file/directory replacement denial, junctions/reparse points, hard links, volume
identity, Unicode/long paths, case aliases, ACL/ownership and unsupported storage.
Use isolated fixtures, never production vaults. Verify native closure after errors
with process/handle evidence; simulated reporting alone does not qualify this.

Current blockers: Windows ACL policy is undefined; POSIX chmod-based tests cannot
be treated as Windows acceptance, and several tests return early on Windows.
Replace these with explicitly skipped POSIX tests plus real Windows equivalents
in a separately reviewed work package. Windows native source has not been compiled
here. F4/H2 scopes and Phase 31B.2 remain unapproved for implementation.

## Compatibility and release limits

Test drive letters, UNC rejection/unsupported diagnostics, separators, case-insensitive
collisions, symlink privileges and read-only ACLs. Do not port POSIX mode assumptions
onto NTFS. Keep .nodus-vault-write.lock manual recovery unchanged. Test old backup
versions, portable import freshness/recovery, editor draft migration and conflict
flows before claiming general Windows readiness. Process-crash recovery is not
universal power-loss durability.

Vite build produces UI assets; it does not package the native addon or a production
Node host. build:executor-lock creates local .node binaries, including a test-only
binary which must never be distributed as the runtime addon. Production packaging,
signing/prebuild distribution, and any desktop host are later gates.
