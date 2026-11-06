"use client";

import { FormEvent, useRef, useState } from "react";
import { User } from "@/lib/api";
import { useDialogAccessibility } from "@/components/use-dialog-accessibility";

export type AccountUpdate = {
  current_password: string;
  name: string;
  email: string;
  new_password?: string;
};

export function AccountDialog({
  user,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  user: User;
  busy: boolean;
  onClose: () => void;
  onSave: (body: AccountUpdate) => Promise<void>;
  onDelete: (currentPassword: string) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  useDialogAccessibility(dialogRef, onClose);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if ((newPassword || confirmPassword) && newPassword !== confirmPassword) {
      setError("A confirmação da nova senha não corresponde.");
      return;
    }
    const data = new FormData(event.currentTarget);
    try {
      await onSave({
        current_password: currentPassword,
        name: String(data.get("name")).trim(),
        email: String(data.get("email")).trim(),
        ...(newPassword ? { new_password: newPassword } : {}),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível atualizar a conta.");
    }
  };

  const deleteAccount = async () => {
    setError("");
    if (currentPassword.length < 8) {
      setError("Informe sua senha atual para excluir a conta.");
      return;
    }
    const confirmed = window.confirm(
      "Excluir sua conta também remove suas fazendas, talhões, sensores, leituras, safras, operações, regras e alertas. Esta ação não pode ser desfeita. Deseja continuar?",
    );
    if (!confirmed) return;
    try {
      await onDelete(currentPassword);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível excluir a conta.");
    }
  };

  return (
    <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} className="modal-card" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title">
        <div className="modal-heading">
          <div>
            <h2 id="account-dialog-title">Minha conta</h2>
            <p>Atualize seus dados de acesso e perfil.</p>
          </div>
          <button type="button" className="icon-button" aria-label="Fechar" onClick={onClose}>×</button>
        </div>
        <form className="modal-form" onSubmit={submit}>
          <div className="form-grid">
            <label className="span-2">Nome<input name="name" defaultValue={user.name} minLength={2} maxLength={80} required autoFocus/></label>
            <label className="span-2">E-mail<input name="email" type="email" defaultValue={user.email} autoComplete="email" required/></label>
            <label className="span-2">Senha atual<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" minLength={8} maxLength={72} required/></label>
            <label>Nova senha<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={72} placeholder="Opcional"/></label>
            <label>Confirmar nova senha<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={72} placeholder="Opcional"/></label>
          </div>
          {error && <div className="inline-error" role="alert">{error}</div>}
          <div className="account-actions">
            <button className="danger-link account-delete" type="button" disabled={busy} onClick={() => void deleteAccount()}>Excluir conta</button>
            <div className="modal-actions">
              <button className="button secondary" type="button" onClick={onClose}>Cancelar</button>
              <button className="button primary" type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar alterações"}</button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
