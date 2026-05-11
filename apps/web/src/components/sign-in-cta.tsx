import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { orpc } from '../lib/orpc.ts';
import { Button } from './ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.tsx';

interface SignInCtaProps {
  /** Optional explicit return URL the api should send the user back to
   *  after OAuth completes. Defaults to the current origin's
   *  `/?drive=connected`, matching what {@link DriveFolderPicker} uses. */
  returnTo?: string;
}

/**
 * The "no session yet" entry point on the landing page. Rendered in
 * place of the Drive folder picker when `listFolders` returns a
 * Drive-auth-shaped error. Kicks off the same OAuth flow the picker
 * does internally (`ingestion.authStart` → redirect → callback lands
 * back on `/?drive=connected`).
 */
export function SignInCta({ returnTo }: SignInCtaProps) {
  const authStart = useMutation({
    ...orpc.ingestion.authStart.mutationOptions(),
    onSuccess: (data) => {
      window.location.assign(data.authorizationUrl);
    },
  });
  const triggerOauth = () => {
    const target =
      returnTo ?? `${window.location.origin}${window.location.pathname}?drive=connected`;
    authStart.mutate({ returnTo: target });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
    >
      <Card className="border-accent/30 bg-accent/2">
        <CardHeader>
          <CardTitle className="font-serif text-2xl">Compile your own folder</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Sign in with Google to compile your own folder into a typed, span-verified wiki.
          </p>
          <Button variant="accent" onClick={triggerOauth} disabled={authStart.isPending}>
            {authStart.isPending ? 'Redirecting…' : 'Sign in with Google'}
          </Button>
          {authStart.isError ? (
            <p className="text-xs text-destructive">{(authStart.error as Error).message}</p>
          ) : null}
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Read-only Drive access · we never store your files
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}
