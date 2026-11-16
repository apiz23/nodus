#include <node_api.h>

#include <string>
#include <vector>
#include <deque>
#include <memory>

#ifdef _WIN32
#include <windows.h>
#include <string>
#else
#include <cerrno>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#if defined(__APPLE__)
#include <sys/mount.h>
#include <sys/file.h>
#else
#include <sys/vfs.h>
#include <sys/file.h>
#endif
#endif

namespace {

struct Diagnostics;
struct LockHandle {
  std::shared_ptr<Diagnostics> diagnostics;
  bool locked = false;
#ifdef _WIN32
  HANDLE file = INVALID_HANDLE_VALUE;
  OVERLAPPED range{};
#else
  int fd = -1;
#endif
  std::string path;
  std::string parent;
#ifdef _WIN32
  HANDLE directory = INVALID_HANDLE_VALUE;
#else
  int directory = -1;
#endif
  bool released = false;
  bool invalidated = false;
};

void Throw(napi_env env, const char* code, const std::string& message) {
  napi_throw_error(env, code, message.c_str());
}

bool ReadPath(napi_env env, napi_value value, std::string* path) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok || length == 0) {
    Throw(env, "ERR_INVALID_PATH", "Lock path must be a non-empty string");
    return false;
  }
  path->resize(length + 1);
  if (napi_get_value_string_utf8(env, value, path->data(), length + 1, &length) != napi_ok) {
    Throw(env, "ERR_INVALID_PATH", "Could not read lock path");
    return false;
  }
  path->resize(length);
  if (path->find('\0') != std::string::npos) {
    Throw(env, "ERR_INVALID_PATH", "Lock path contains NUL"); return false;
  }
  return true;
}

#ifdef _WIN32
std::wstring ToWide(const std::string& value) {
  if (value.empty()) return {};
  const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.c_str(), -1, nullptr, 0);
  if (size <= 0) return {};
  std::wstring wide(static_cast<size_t>(size), L'\0');
  if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.c_str(), -1, wide.data(), size) <= 0) return {};
  wide.resize(static_cast<size_t>(size - 1));
  return wide;
}

bool IsSupportedFilesystem(const std::wstring& path) {
  wchar_t volume[MAX_PATH]{};
  wchar_t filesystem[MAX_PATH]{};
  if (!GetVolumePathNameW(path.c_str(), volume, MAX_PATH)) return false;
  if (GetDriveTypeW(volume) != DRIVE_FIXED) return false;
  if (!GetVolumeInformationW(volume, nullptr, 0, nullptr, nullptr, nullptr, filesystem, MAX_PATH)) return false;
  return _wcsicmp(filesystem, L"NTFS") == 0;
}
#else
bool IsSupportedFilesystem(int fd) {
  struct statfs info {};
  if (fstatfs(fd, &info) != 0) return false;
#if defined(__APPLE__)
  return std::string(info.f_fstypename) == "apfs";
#elif defined(__linux__)
  const unsigned long type = static_cast<unsigned long>(info.f_type);
  return type == 0xEF53UL || type == 0x58465342UL || type == 0x9123683EUL;
#else
  return false;
#endif
}
#endif

struct CleanupFailure { std::string operation; unsigned long code; };
struct CleanupDiagnostic {
  std::string path;
  std::string context;
  std::vector<CleanupFailure> failures;
};
// Per Node environment: bounded diagnostics, never used as liveness evidence.
struct Diagnostics {
  std::deque<CleanupDiagnostic> records;
  unsigned long dropped = 0;
#ifdef NODUS_LOCK_TESTING
  unsigned int faults = 0;
#endif
};

Diagnostics* GetDiagnostics(napi_env env) {
  void* data = nullptr;
  napi_get_instance_data(env, &data);
  return data ? static_cast<std::shared_ptr<Diagnostics>*>(data)->get() : nullptr;
}

std::vector<CleanupFailure> Cleanup(napi_env env, LockHandle* lock) {
  std::vector<CleanupFailure> failures;
  auto record = [&](const char* operation, bool success, unsigned long code, unsigned int bit) {
#ifdef NODUS_LOCK_TESTING
    auto* diagnostics = lock->diagnostics.get();
    if (diagnostics && (diagnostics->faults & bit)) { success = false; code = 99999; }
#else
    (void)bit;
#endif
    if (!success) failures.push_back({operation, code});
  };
  if (!lock->released) {
    lock->released = true;
#ifdef _WIN32
    if (lock->file != INVALID_HANDLE_VALUE) {
      if (lock->locked) {
      const bool unlocked = UnlockFileEx(lock->file, 0, 1, 0, &lock->range) != 0;
      record("unlock", unlocked, unlocked ? 0 : GetLastError(), 1);
      }
      const bool closed = CloseHandle(lock->file) != 0;
      record("close-file", closed, closed ? 0 : GetLastError(), 2);
      lock->file = INVALID_HANDLE_VALUE;
    }
#else
    if (lock->fd >= 0) {
      if (lock->locked) {
      const int unlocked = flock(lock->fd, LOCK_UN);
      record("unlock", unlocked == 0, unlocked == 0 ? 0 : errno, 1);
      }
      const int closed = close(lock->fd);
      record("close-file", closed == 0, closed == 0 ? 0 : errno, 2);
      lock->fd = -1;
    }
#endif
  }
#ifdef _WIN32
  if (lock->directory != INVALID_HANDLE_VALUE) {
    const bool closed = CloseHandle(lock->directory) != 0;
    record("close-directory", closed, closed ? 0 : GetLastError(), 4);
    lock->directory = INVALID_HANDLE_VALUE;
  }
#else
  if (lock->directory >= 0) {
    const int closed = close(lock->directory);
    record("close-directory", closed == 0, closed == 0 ? 0 : errno, 4);
    lock->directory = -1;
  }
#endif
#ifdef NODUS_LOCK_TESTING
  if (auto* diagnostics = lock->diagnostics.get()) diagnostics->faults = 0;
#endif
  return failures;
}

napi_value DiagnosticValue(napi_env env, const CleanupDiagnostic& diagnostic) {
  napi_value result, value, failures;
  napi_create_object(env, &result);
  napi_create_string_utf8(env, diagnostic.path.c_str(), NAPI_AUTO_LENGTH, &value);
  napi_set_named_property(env, result, "path", value);
  napi_create_string_utf8(env, diagnostic.context.c_str(), NAPI_AUTO_LENGTH, &value);
  napi_set_named_property(env, result, "context", value);
  napi_create_array_with_length(env, diagnostic.failures.size(), &failures);
  for (size_t i = 0; i < diagnostic.failures.size(); ++i) {
    napi_value failure;
    napi_create_object(env, &failure);
    napi_create_string_utf8(env, diagnostic.failures[i].operation.c_str(), NAPI_AUTO_LENGTH, &value);
    napi_set_named_property(env, failure, "operation", value);
    napi_create_double(env, diagnostic.failures[i].code, &value);
    napi_set_named_property(env, failure, "code", value);
    napi_set_element(env, failures, i, failure);
  }
  napi_set_named_property(env, result, "failures", failures);
  return result;
}

void Remember(Diagnostics* diagnostics, const CleanupDiagnostic& diagnostic) {
  if (!diagnostics || diagnostic.failures.empty()) return;
  if (diagnostics->records.size() == 32) { diagnostics->records.pop_front(); ++diagnostics->dropped; }
  diagnostics->records.push_back(diagnostic);
}

void FinalizeLock(napi_env env, void* data, void*) {
  auto* lock = static_cast<LockHandle*>(data);
  if (!lock) return;
  Remember(lock->diagnostics.get(), {lock->path, "acquisition-or-finalizer", Cleanup(env, lock)});
  delete lock;
}

napi_value ReadCleanupDiagnostics(napi_env env, napi_callback_info) {
  napi_value result, records, dropped;
  napi_create_object(env, &result);
  auto* diagnostics = GetDiagnostics(env);
  const size_t count = diagnostics ? diagnostics->records.size() : 0;
  napi_create_array_with_length(env, count, &records);
  for (size_t i = 0; i < count; ++i) napi_set_element(env, records, i, DiagnosticValue(env, diagnostics->records[i]));
  napi_create_double(env, diagnostics ? diagnostics->dropped : 0, &dropped);
  napi_set_named_property(env, result, "records", records);
  napi_set_named_property(env, result, "dropped", dropped);
  return result;
}
#ifdef NODUS_LOCK_TESTING
napi_value SetCleanupFaults(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1]; unsigned int faults = 0;
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 1 || napi_get_value_uint32(env, argv[0], &faults) != napi_ok) {
    Throw(env, "ERR_INVALID_ARGUMENT", "Expected cleanup fault mask"); return nullptr;
  }
  GetDiagnostics(env)->faults = faults;
  napi_value result; napi_get_undefined(env, &result); return result;
}
#endif

bool IdentityValid(LockHandle* lock) {
#ifdef _WIN32
  BY_HANDLE_FILE_INFORMATION held{}, named{}, directory{}, current_directory{};
  const auto wide = ToWide(lock->path);
  const auto parent = ToWide(lock->parent);
  HANDLE check = CreateFileW(wide.c_str(), FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE,
      nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  HANDLE root = CreateFileW(parent.c_str(), FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE,
      nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  const bool valid = check != INVALID_HANDLE_VALUE && root != INVALID_HANDLE_VALUE &&
      GetFileType(lock->file) == FILE_TYPE_DISK &&
      GetFileInformationByHandle(lock->file, &held) && GetFileInformationByHandle(check, &named) &&
      GetFileInformationByHandle(lock->directory, &directory) && GetFileInformationByHandle(root, &current_directory) &&
      !(held.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) &&
      !(named.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) &&
      !(current_directory.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) && held.nNumberOfLinks == 1 &&
      held.dwVolumeSerialNumber == directory.dwVolumeSerialNumber &&
      held.dwVolumeSerialNumber == named.dwVolumeSerialNumber &&
      held.nFileIndexHigh == named.nFileIndexHigh && held.nFileIndexLow == named.nFileIndexLow &&
      directory.dwVolumeSerialNumber == current_directory.dwVolumeSerialNumber &&
      directory.nFileIndexHigh == current_directory.nFileIndexHigh && directory.nFileIndexLow == current_directory.nFileIndexLow;
  if (check != INVALID_HANDLE_VALUE) CloseHandle(check);
  if (root != INVALID_HANDLE_VALUE) CloseHandle(root);
  wchar_t fs[MAX_PATH]{};
  return valid && GetVolumeInformationByHandleW(lock->file, nullptr, 0, nullptr, nullptr, nullptr, fs, MAX_PATH) && _wcsicmp(fs, L"NTFS") == 0;
#else
  struct stat held{}, named{}, directory{}, current_directory{};
  const std::string name = lock->path.substr(lock->path.find_last_of('/') + 1);
  return fstat(lock->fd, &held) == 0 && fstatat(lock->directory, name.c_str(), &named, AT_SYMLINK_NOFOLLOW) == 0 &&
      fstat(lock->directory, &directory) == 0 && lstat(lock->parent.c_str(), &current_directory) == 0 &&
      S_ISDIR(current_directory.st_mode) && directory.st_dev == current_directory.st_dev && directory.st_ino == current_directory.st_ino &&
      directory.st_uid == geteuid() && (directory.st_mode & 0022) == 0 &&
      S_ISREG(held.st_mode) && S_ISREG(named.st_mode) && held.st_uid == geteuid() &&
      (held.st_mode & 0777) == 0600 && held.st_nlink == 1 &&
      held.st_dev == directory.st_dev && held.st_dev == named.st_dev && held.st_ino == named.st_ino &&
      IsSupportedFilesystem(lock->fd);
#endif
}

napi_value Validate(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  void* data = nullptr;
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1 ||
      napi_get_value_external(env, argv[0], &data) != napi_ok || data == nullptr) {
    Throw(env, "ERR_INVALID_HANDLE", "Expected executor lock handle"); return nullptr;
  }
  auto* lock = static_cast<LockHandle*>(data);
  if (lock->released || lock->invalidated || !IdentityValid(lock)) {
    lock->invalidated = true;
    Throw(env, "ERR_LOCK_IDENTITY", "Executor lock identity is uncertain; stop protected operations"); return nullptr;
  }
  napi_value result;
  napi_get_boolean(env, true, &result);
  return result;
}

napi_value TryAcquire(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1) {
    Throw(env, "ERR_INVALID_ARGUMENT", "tryAcquire requires one lock path");
    return nullptr;
  }
  std::string path;
  if (!ReadPath(env, argv[0], &path)) return nullptr;
  const size_t separator = path.find_last_of("/\\");
  const std::string parent = separator == std::string::npos ? "." : (separator == 0 ? path.substr(0, 1) : path.substr(0, separator));

  auto* lock = new LockHandle();
  void* instance = nullptr;
  napi_get_instance_data(env, &instance);
  lock->diagnostics = *static_cast<std::shared_ptr<Diagnostics>*>(instance);
  lock->path = path;
  lock->parent = parent;
#ifdef _WIN32
  const std::wstring wide = ToWide(path);
  const std::wstring wide_parent = ToWide(parent);
  if (wide.empty() || wide_parent.empty()) {
    delete lock;
    Throw(env, "ERR_INVALID_PATH", "Lock path is not valid UTF-8");
    return nullptr;
  }
  if (!IsSupportedFilesystem(wide_parent)) {
    delete lock;
    Throw(env, "ERR_UNSUPPORTED_FILESYSTEM", "Executor locking is supported only on fixed NTFS volumes");
    return nullptr;
  }
  lock->directory = CreateFileW(wide_parent.c_str(), FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  if (lock->directory == INVALID_HANDLE_VALUE) {
    FinalizeLock(env, lock, nullptr);
    Throw(env, "ERR_LOCK_IDENTITY", "Could not retain vault directory handle"); return nullptr;
  }
  lock->file = CreateFileW(wide.c_str(), GENERIC_READ | GENERIC_WRITE,
      FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_ALWAYS,
      FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  if (lock->file == INVALID_HANDLE_VALUE) {
    const DWORD error = GetLastError();
    FinalizeLock(env, lock, nullptr);
    Throw(env, "ERR_LOCK_IO", "Could not open persistent executor lock file (Windows error " + std::to_string(error) + ")");
    return nullptr;
  }
  BY_HANDLE_FILE_INFORMATION file_info{};
  if (!GetFileInformationByHandle(lock->file, &file_info) || (file_info.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0) {
    FinalizeLock(env, lock, nullptr);
    Throw(env, "ERR_UNSAFE_LOCK_FILE", "Executor lock path must be a regular, non-reparse file");
    return nullptr;
  }
  if (!IdentityValid(lock)) {
    FinalizeLock(env, lock, nullptr);
    Throw(env, "ERR_LOCK_IDENTITY", "Unsafe executor lock identity"); return nullptr;
  }
  if (!LockFileEx(lock->file, LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &lock->range)) {
    const DWORD error = GetLastError();
    FinalizeLock(env, lock, nullptr);
    if (error == ERROR_LOCK_VIOLATION) {
      napi_value null_value;
      napi_get_null(env, &null_value);
      return null_value;
    }
    Throw(env, "ERR_LOCK_UNCERTAIN", "Could not establish executor ownership (Windows error " + std::to_string(error) + ")");
    return nullptr;
  }
#else
  lock->directory = open(parent.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  if (lock->directory < 0 || !IsSupportedFilesystem(lock->directory)) {
    FinalizeLock(env, lock, nullptr);
    Throw(env, "ERR_UNSUPPORTED_FILESYSTEM", "Executor locking is supported only on APFS, ext4, XFS, and Btrfs");
    return nullptr;
  }
  const std::string name = path.substr(separator + 1);
  struct stat existing{};
  if (fstatat(lock->directory, name.c_str(), &existing, AT_SYMLINK_NOFOLLOW) == 0 && !S_ISREG(existing.st_mode)) {
    FinalizeLock(env, lock, nullptr);
    Throw(env, "ERR_UNSAFE_LOCK_FILE", "Existing executor lock is not regular"); return nullptr;
  }
  lock->fd = openat(lock->directory, name.c_str(), O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK, 0600);
  if (lock->fd < 0) {
    const int error = errno;
    FinalizeLock(env, lock, nullptr);
    Throw(env, "ERR_LOCK_IO", "Could not open persistent executor lock file (errno " + std::to_string(error) + ")");
    return nullptr;
  }
  struct stat file_info {};
  if (fstat(lock->fd, &file_info) != 0 || !S_ISREG(file_info.st_mode)) {
    FinalizeLock(env, lock, nullptr);
    Throw(env, "ERR_UNSAFE_LOCK_FILE", "Executor lock path must be a regular, non-symlink file");
    return nullptr;
  }
  if (!IdentityValid(lock)) {
    FinalizeLock(env, lock, nullptr);
    Throw(env, "ERR_LOCK_IDENTITY", "Unsafe executor lock identity"); return nullptr;
  }
  int result;
  do { result = flock(lock->fd, LOCK_EX | LOCK_NB); } while (result != 0 && errno == EINTR);
  if (result != 0) {
    const int error = errno;
    FinalizeLock(env, lock, nullptr);
    if (error == EWOULDBLOCK || error == EAGAIN) {
      napi_value null_value;
      napi_get_null(env, &null_value);
      return null_value;
    }
    Throw(env, "ERR_LOCK_UNCERTAIN", "Could not establish executor ownership (errno " + std::to_string(error) + ")");
    return nullptr;
  }
#endif

  lock->locked = true;
  if (!IdentityValid(lock)) {
    FinalizeLock(env, lock, nullptr);
    Throw(env, "ERR_LOCK_IDENTITY", "Executor lock or vault directory changed during acquisition"); return nullptr;
  }
  napi_value external;
  if (napi_create_external(env, lock, FinalizeLock, nullptr, &external) != napi_ok) {
    FinalizeLock(env, lock, nullptr);
    Throw(env, "ERR_LOCK_RESOURCE", "Could not retain native executor lock handle");
    return nullptr;
  }
  return external;
}

napi_value Release(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  void* data = nullptr;
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1 || napi_get_value_external(env, argv[0], &data) != napi_ok || data == nullptr) {
    Throw(env, "ERR_INVALID_HANDLE", "release requires a native executor lock handle");
    return nullptr;
  }
  auto* lock = static_cast<LockHandle*>(data);
  if (lock->released) {
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
  }
  const auto failures = Cleanup(env, lock);
  if (!failures.empty()) {
    CleanupDiagnostic diagnostic{lock->path, "release", failures};
    Remember(lock->diagnostics.get(), diagnostic);
    napi_value message, error, code;
    napi_create_string_utf8(env, "Executor cleanup failed; authorization ended but handle closure is uncertain", NAPI_AUTO_LENGTH, &message);
    napi_create_error(env, nullptr, message, &error);
    napi_create_string_utf8(env, "ERR_LOCK_RELEASE", NAPI_AUTO_LENGTH, &code);
    napi_set_named_property(env, error, "code", code);
    napi_set_named_property(env, error, "cleanup", DiagnosticValue(env, diagnostic));
    napi_throw(env, error);
    return nullptr;
  }
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_set_instance_data(env, new std::shared_ptr<Diagnostics>(std::make_shared<Diagnostics>()), [](napi_env, void* data, void*) { delete static_cast<std::shared_ptr<Diagnostics>*>(data); }, nullptr);
  napi_property_descriptor properties[] = {
    {"readCleanupDiagnostics", nullptr, ReadCleanupDiagnostics, nullptr, nullptr, nullptr, napi_default, nullptr},
#ifdef NODUS_LOCK_TESTING
    {"setCleanupFaults", nullptr, SetCleanupFaults, nullptr, nullptr, nullptr, napi_default, nullptr},
#endif
    {"tryAcquire", nullptr, TryAcquire, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"validate", nullptr, Validate, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"release", nullptr, Release, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
