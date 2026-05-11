import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { orpc } from '../../lib/orpc.ts';
import { Button } from '../ui/button.tsx';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog.tsx';

export interface DeleteWikiButtonProps {
  wikiId: string;
  /** Folder name shown in the confirmation gate. The user must type this
   *  exactly to enable the destructive Delete button — same pattern as
   *  GitHub repo deletion. */
  folderName: string;
}

/**
 * Small destructive button + confirmation modal that calls
 * `wiki.deleteWiki` and navigates back to the home page on success. The
 * "type the folder name to confirm" gate stops fat-finger deletes; the
 * compile takes minutes, so an accidental click is expensive.
 */
export function DeleteWikiButton({ wikiId, folderName }: DeleteWikiButtonProps) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const trimmedTarget = folderName.trim();
  const armed = typed.trim() === trimmedTarget && trimmedTarget.length > 0;

  const del = useMutation({
    ...orpc.wiki.deleteWiki.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orpc.wiki.listWikis.queryKey({ input: {} }) });
      setOpen(false);
      nav('/', { replace: true });
    },
  });

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setTyped('');
          setOpen(true);
        }}
        className="border-destructive/40 text-destructive hover:bg-destructive/10"
      >
        Delete wiki
      </Button>
      <Dialog open={open} onOpenChange={(o) => !del.isPending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="font-serif text-2xl">Delete this wiki?</DialogTitle>
          <p className="text-sm text-muted-foreground">
            This permanently removes the wiki, every page, claim, citation, backlink, and page-body
            blob. The Drive folder + ingested sources stay — you can re-compile from the home page
            anytime.
          </p>
          <p className="text-sm">
            To confirm, type the folder name:{' '}
            <span className="font-mono font-medium text-foreground">{folderName}</span>
          </p>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={folderName}
            // biome-ignore lint/a11y/noAutofocus: confirm-by-typing modal — focusing the input on open is the entire point.
            autoFocus
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors focus:outline-hidden focus:ring-2 focus:ring-destructive"
          />
          {del.isError ? (
            <p className="text-xs text-destructive">{(del.error as Error).message}</p>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={del.isPending}
            >
              Cancel
            </Button>
            <motion.div whileTap={armed ? { scale: 0.97 } : undefined}>
              <Button
                size="sm"
                onClick={() => del.mutate({ id: wikiId })}
                disabled={!armed || del.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:bg-destructive/40"
              >
                {del.isPending ? 'Deleting…' : 'Delete forever'}
              </Button>
            </motion.div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
