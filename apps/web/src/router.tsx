import { createBrowserRouter } from 'react-router-dom';
import { ChatRoute } from './routes/chat.tsx';
import { CompileRoute } from './routes/compile.tsx';
import { DesignSystemRoute } from './routes/design-system.tsx';
import { GapsRoute } from './routes/gaps.tsx';
import { IngestRoute } from './routes/ingest.tsx';
import { LintRoute } from './routes/lint.tsx';
import { PresentRoute } from './routes/present.tsx';
import { RootRoute } from './routes/root.tsx';
import { WikiPageRoute } from './routes/wiki-page.tsx';
import { WikiRoute } from './routes/wiki.tsx';

export const router = createBrowserRouter([
  { path: '/', element: <RootRoute /> },
  { path: '/wiki/:wikiId', element: <WikiRoute /> },
  { path: '/wiki/:wikiId/page/:pageId', element: <WikiPageRoute /> },
  { path: '/wiki/:wikiId/lint', element: <LintRoute /> },
  { path: '/wiki/:wikiId/gaps', element: <GapsRoute /> },
  { path: '/chat/:conversationId', element: <ChatRoute /> },
  // Ingest-in-progress page. The picker on `/` navigates here after
  // `registerFolder` returns a `folderId`; this route fires `ingestFolder`
  // on mount, animates per-file progress via polled `listSources`, then
  // chains into `startCompile` + nav to `/compile/:compileRunId`.
  { path: '/folder/:folderId/ingest', element: <IngestRoute /> },
  // Compile-in-progress page. Auto-redirects to `/wiki/:wikiId` once the
  // CompileRun surfaces its wikiId.
  { path: '/compile/:compileRunId', element: <CompileRoute /> },
  { path: '/design-system', element: <DesignSystemRoute /> },
  // Non-technical talk-style explainer of what tenex does and why.
  // Full-screen slide deck; ← / → / space to navigate, F for fullscreen.
  { path: '/present', element: <PresentRoute /> },
]);
