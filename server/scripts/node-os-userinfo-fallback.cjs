const os = require('node:os');

try {
  os.userInfo();
} catch (error) {
  const isWindowsUserLookupFailure = process.platform === 'win32' &&
    error?.code === 'ERR_SYSTEM_ERROR' && error?.syscall === 'uv_os_get_passwd';
  const username = process.env.USERNAME;

  if (!isWindowsUserLookupFailure || !username) throw error;

  os.userInfo = () => ({
    username,
    uid: -1,
    gid: -1,
    shell: null,
    homedir: os.homedir(),
  });
}
