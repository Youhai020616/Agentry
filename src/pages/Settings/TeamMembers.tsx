/**
 * Team Members Settings Component
 * Local multi-user management: list, add, edit, delete, switch users
 */
import { useEffect, useState, useCallback } from 'react';
import { Users, Plus, Pencil, Trash2, Check, UserCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/native-select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { User, UserRole, CreateUserInput } from '@/types/user';

const ROLE_VARIANTS: Record<UserRole, 'default' | 'secondary' | 'outline'> = {
  admin: 'default',
  manager: 'secondary',
  member: 'outline',
};

export function TeamMembers() {
  const { t } = useTranslation('settings');
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Dialog states
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState<UserRole>('member');

  const fetchUsers = useCallback(async () => {
    try {
      const [listResult, currentResult] = await Promise.all([
        window.electron.ipcRenderer.invoke('user:list') as Promise<{
          success: boolean;
          result?: User[];
          error?: string;
        }>,
        window.electron.ipcRenderer.invoke('user:current') as Promise<{
          success: boolean;
          result?: User;
          error?: string;
        }>,
      ]);
      if (listResult.success) {
        setUsers(listResult.result ?? []);
      }
      if (currentResult.success && currentResult.result) {
        setCurrentUser(currentResult.result);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleAddUser = async () => {
    if (!formName.trim()) return;
    try {
      const input: CreateUserInput = {
        name: formName.trim(),
        email: formEmail.trim() || undefined,
        role: formRole,
      };
      const result = (await window.electron.ipcRenderer.invoke('user:create', input)) as {
        success: boolean;
        result?: User;
        error?: string;
      };
      if (result.success) {
        toast.success(t('teamMembers.toast.added'));
        setShowAddDialog(false);
        resetForm();
        fetchUsers();
      } else {
        toast.error(result.error ?? t('teamMembers.toast.failedAdd'));
      }
    } catch (error) {
      toast.error(String(error));
    }
  };

  const handleEditUser = async () => {
    if (!editingUser || !formName.trim()) return;
    try {
      const result = (await window.electron.ipcRenderer.invoke('user:update', {
        id: editingUser.id,
        updates: {
          name: formName.trim(),
          email: formEmail.trim() || undefined,
          role: formRole,
        },
      })) as {
        success: boolean;
        result?: User;
        error?: string;
      };
      if (result.success) {
        toast.success(t('teamMembers.toast.updated'));
        setEditingUser(null);
        resetForm();
        fetchUsers();
      } else {
        toast.error(result.error ?? t('teamMembers.toast.failedUpdate'));
      }
    } catch (error) {
      toast.error(String(error));
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;
    try {
      const result = (await window.electron.ipcRenderer.invoke(
        'user:delete',
        deletingUser.id
      )) as {
        success: boolean;
        error?: string;
      };
      if (result.success) {
        toast.success(t('teamMembers.toast.deleted'));
        setDeletingUser(null);
        fetchUsers();
      } else {
        toast.error(result.error ?? t('teamMembers.toast.failedDelete'));
      }
    } catch (error) {
      toast.error(String(error));
    }
  };

  const handleSwitchUser = async (userId: string) => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('user:switch', userId)) as {
        success: boolean;
        result?: User;
        error?: string;
      };
      if (result.success) {
        toast.success(t('teamMembers.toast.switched'));
        fetchUsers();
      } else {
        toast.error(result.error ?? t('teamMembers.toast.failedSwitch'));
      }
    } catch (error) {
      toast.error(String(error));
    }
  };

  const openEditDialog = (user: User) => {
    setFormName(user.name);
    setFormEmail(user.email ?? '');
    setFormRole(user.role);
    setEditingUser(user);
  };

  const resetForm = () => {
    setFormName('');
    setFormEmail('');
    setFormRole('member');
  };

  const openAddDialog = () => {
    resetForm();
    setShowAddDialog(true);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return null;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                {t('teamMembers.title')}
              </CardTitle>
              <CardDescription>{t('teamMembers.description')}</CardDescription>
            </div>
            <Button size="sm" onClick={openAddDialog}>
              <Plus className="h-4 w-4 mr-2" />
              {t('teamMembers.add')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('teamMembers.noUsers')}</p>
          ) : (
            <div className="space-y-3">
              {users.map((user) => {
                const isCurrent = currentUser?.id === user.id;
                return (
                  <div
                    key={user.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
                        <UserCircle className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{user.name}</span>
                          <Badge variant={ROLE_VARIANTS[user.role]}>
                            {t(`teamMembers.role.${user.role}`)}
                          </Badge>
                          {isCurrent && (
                            <Badge variant="success">{t('teamMembers.current')}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {user.email && <span>{user.email} &middot; </span>}
                          {t('teamMembers.lastLogin')}: {formatDate(user.lastLoginAt)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {!isCurrent && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSwitchUser(user.id)}
                          title={t('teamMembers.switchTo')}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(user)}
                        title={t('teamMembers.edit')}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeletingUser(user)}
                        title={t('teamMembers.delete')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add User Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('teamMembers.addDialog.title')}</DialogTitle>
            <DialogDescription>{t('teamMembers.addDialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('teamMembers.fields.name')}</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={t('teamMembers.fields.namePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('teamMembers.fields.email')}</Label>
              <Input
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                placeholder={t('teamMembers.fields.emailPlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('teamMembers.fields.role')}</Label>
              <Select value={formRole} onChange={(e) => setFormRole(e.target.value as UserRole)}>
                <option value="admin">{t('teamMembers.role.admin')}</option>
                <option value="manager">{t('teamMembers.role.manager')}</option>
                <option value="member">{t('teamMembers.role.member')}</option>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={handleAddUser} disabled={!formName.trim()}>
              {t('teamMembers.add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('teamMembers.editDialog.title')}</DialogTitle>
            <DialogDescription>{t('teamMembers.editDialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('teamMembers.fields.name')}</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={t('teamMembers.fields.namePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('teamMembers.fields.email')}</Label>
              <Input
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                placeholder={t('teamMembers.fields.emailPlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('teamMembers.fields.role')}</Label>
              <Select value={formRole} onChange={(e) => setFormRole(e.target.value as UserRole)}>
                <option value="admin">{t('teamMembers.role.admin')}</option>
                <option value="manager">{t('teamMembers.role.manager')}</option>
                <option value="member">{t('teamMembers.role.member')}</option>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={handleEditUser} disabled={!formName.trim()}>
              {t('common:actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deletingUser} onOpenChange={(open) => !open && setDeletingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('teamMembers.deleteDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('teamMembers.deleteDialog.description', { name: deletingUser?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingUser(null)}>
              {t('common:actions.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDeleteUser}>
              {t('teamMembers.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
