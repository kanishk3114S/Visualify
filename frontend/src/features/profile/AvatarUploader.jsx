import { useEffect, useRef, useState } from "react";
import { Camera, Trash2, Upload } from "lucide-react";
import { Avatar } from "../../components/Avatar.jsx";
import { Button } from "../../components/Button.jsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.jsx";
import { useToast } from "../../components/Toast.jsx";
import { useRemoveAvatar, useUploadAvatar } from "../../hooks/useProfile.js";
import { AVATAR_MIME_TYPES, validateAvatarFile } from "../../lib/schemas.js";

/**
 * Pick -> preview -> upload flow for the profile photo. Client checks are for
 * UX only; the API verifies magic bytes, re-encodes to WebP and strips EXIF.
 */
export function AvatarUploader({ profile }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const upload = useUploadAvatar();
  const remove = useRemoveAvatar();
  const toast = useToast();

  // Revoke object URLs to avoid leaking memory.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function resetSelection() {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onPick(event) {
    const picked = event.target.files?.[0] ?? null;
    if (!picked) return;
    const problem = validateAvatarFile(picked);
    if (problem) {
      setError(problem);
      resetSelection();
      return;
    }
    setError(null);
    setFile(picked);
  }

  function onUpload() {
    upload.mutate(file, {
      onSuccess: () => {
        resetSelection();
        toast.success("Profile photo updated.");
      },
      onError: (err) => setError(err.message),
    });
  }

  function onRemove() {
    remove.mutate(undefined, {
      onSuccess: () => {
        setConfirmOpen(false);
        toast.success("Profile photo removed.");
      },
      onError: (err) => {
        setConfirmOpen(false);
        toast.error(err.message);
      },
    });
  }

  const busy = upload.isPending || remove.isPending;

  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-center" data-testid="avatar-uploader">
      <div className="relative">
        <Avatar
          src={previewUrl ?? profile.avatar_url}
          name={profile.display_name}
          fallbackText={profile.email}
          size="xl"
        />
        {previewUrl && (
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-stone-900 px-2 py-0.5 text-[11px] font-medium text-white">
            Preview
          </span>
        )}
      </div>

      <div className="flex-1 space-y-3">
        <div>
          <h2 className="text-sm font-medium text-stone-900">Profile photo</h2>
          <p className="text-xs text-stone-600">JPEG, PNG or WebP, up to 2 MB. We crop it to a square.</p>
        </div>

        <input
          ref={inputRef}
          id="avatar-file"
          type="file"
          accept={AVATAR_MIME_TYPES.join(",")}
          className="sr-only"
          onChange={onPick}
          aria-describedby={error ? "avatar-error" : undefined}
          data-testid="avatar-file-input"
        />

        <div className="flex flex-wrap gap-2">
          {file ? (
            <>
              <Button size="sm" onClick={onUpload} loading={upload.isPending} loadingText="Uploading…">
                <Upload className="h-4 w-4" aria-hidden="true" />
                Save photo
              </Button>
              <Button size="sm" variant="ghost" onClick={resetSelection} disabled={busy}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
                <Camera className="h-4 w-4" aria-hidden="true" />
                {profile.avatar_url ? "Change photo" : "Upload photo"}
              </Button>
              {profile.avatar_url && (
                <Button size="sm" variant="dangerOutline" onClick={() => setConfirmOpen(true)} disabled={busy}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Remove
                </Button>
              )}
            </>
          )}
        </div>

        {error && (
          <p id="avatar-error" role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Remove profile photo?"
        description="Your photo will be permanently deleted. You can upload a new one at any time."
        confirmLabel="Remove photo"
        loading={remove.isPending}
        onConfirm={onRemove}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
