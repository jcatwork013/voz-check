import { useCallback, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useFetch, errMsg } from '../lib/useFetch';
import { fmtDateTime } from '../lib/format';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/PageHeader';
import { Button, Card, EmptyBlock, ErrorBlock, Input, LoadingBlock } from '../components/ui';
import { Table, TBody, TD, TH, THead, TR } from '../components/Table';
import type { DashboardUser } from '../lib/types';

export default function UsersPage() {
  const toast = useToast();
  const usersFetch = useFetch<{ items: DashboardUser[] }>(useCallback(() => api.listUsers(), []));

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [creating, setCreating] = useState(false);

  const [oldPassword, setOldPassword] = useState('');
  const [changePass, setChangePass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [changing, setChanging] = useState(false);

  async function createUser(e: FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error('Mật khẩu phải có ít nhất 6 ký tự');
      return;
    }
    setCreating(true);
    try {
      await api.createUser(newUsername.trim(), newPassword);
      toast.success(`Đã tạo tài khoản "${newUsername.trim()}"`);
      setNewUsername('');
      setNewPassword('');
      usersFetch.reload();
    } catch (e2) {
      toast.error(errMsg(e2));
    } finally {
      setCreating(false);
    }
  }

  async function doChangePassword(e: FormEvent) {
    e.preventDefault();
    if (changePass.length < 6) {
      toast.error('Mật khẩu mới phải có ít nhất 6 ký tự');
      return;
    }
    if (changePass !== confirmPass) {
      toast.error('Mật khẩu xác nhận không khớp');
      return;
    }
    setChanging(true);
    try {
      await api.changePassword(oldPassword, changePass);
      toast.success('Đã đổi mật khẩu');
      setOldPassword('');
      setChangePass('');
      setConfirmPass('');
    } catch (e2) {
      toast.error(errMsg(e2));
    } finally {
      setChanging(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Tài khoản"
        description="Quản lý tài khoản quản trị viên truy cập bảng điều khiển VozCheck."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <div className="border-b border-white/10 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-50">Danh sách tài khoản</h3>
            </div>
            {usersFetch.loading && !usersFetch.data ? (
              <LoadingBlock />
            ) : usersFetch.error ? (
              <div className="p-5">
                <ErrorBlock message={usersFetch.error} onRetry={usersFetch.reload} />
              </div>
            ) : !usersFetch.data || usersFetch.data.items.length === 0 ? (
              <EmptyBlock message="Chưa có tài khoản nào." />
            ) : (
              <Table>
                <THead>
                  <TH>ID</TH>
                  <TH>Tên đăng nhập</TH>
                  <TH>Ngày tạo</TH>
                </THead>
                <TBody>
                  {usersFetch.data.items.map((u) => (
                    <TR key={u.id}>
                      <TD className="text-slate-400">#{u.id}</TD>
                      <TD className="font-medium text-slate-100">{u.username}</TD>
                      <TD className="text-slate-400">{fmtDateTime(u.created_at)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <div className="border-b border-white/10 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-50">Tạo tài khoản mới</h3>
            </div>
            <form onSubmit={createUser} className="space-y-4 p-5">
              <Input
                label="Tên đăng nhập"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="username"
                autoComplete="off"
                required
              />
              <Input
                label="Mật khẩu"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Tối thiểu 6 ký tự"
                autoComplete="new-password"
                required
              />
              <Button type="submit" loading={creating} className="w-full">
                Tạo tài khoản
              </Button>
            </form>
          </Card>

          <Card>
            <div className="border-b border-white/10 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-50">Đổi mật khẩu</h3>
              <p className="mt-0.5 text-sm text-slate-400">Cho tài khoản đang đăng nhập.</p>
            </div>
            <form onSubmit={doChangePassword} className="space-y-4 p-5">
              <Input
                label="Mật khẩu hiện tại"
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <Input
                label="Mật khẩu mới"
                type="password"
                value={changePass}
                onChange={(e) => setChangePass(e.target.value)}
                placeholder="Tối thiểu 6 ký tự"
                autoComplete="new-password"
                required
              />
              <Input
                label="Xác nhận mật khẩu mới"
                type="password"
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                autoComplete="new-password"
                required
              />
              <Button type="submit" loading={changing} className="w-full">
                Đổi mật khẩu
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
