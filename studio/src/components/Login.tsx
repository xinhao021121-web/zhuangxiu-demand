'use client';

import { useState } from 'react';
import type { User } from '@zx/contracts';
import { api, ApiError, setToken } from '../lib/api';

/** 公司内部账号：手机号 + 验证码换 token（技术方案 4.2，不做对外注册）。 */
export function LoginView({ onLogin }: { onLogin: (user: User) => void }) {
  const [phone, setPhone] = useState('13800000002');
  const [code, setCode] = useState('000000');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api.login(phone, code);
      setToken(result.token);
      onLogin(result.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="login" onSubmit={submit}>
      <h1>设计需求解读台</h1>
      <p>公司内部工具。登录后导入房主填好的需求单，出门前把量房沟通清单做出来。</p>
      <label htmlFor="phone">手机号</label>
      <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="username" />
      <label htmlFor="code">验证码</label>
      <input id="code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" />
      {error ? <p className="err">{error}</p> : null}
      <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%' }}>
        {busy ? '正在登录…' : '登录'}
      </button>
    </form>
  );
}
