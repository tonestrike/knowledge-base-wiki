import { createBrowserRouter } from 'react-router-dom';
import { ChatRoute } from './routes/chat.tsx';
import { DesignSystemRoute } from './routes/design-system.tsx';
import { GapsRoute } from './routes/gaps.tsx';
import { LintRoute } from './routes/lint.tsx';
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
  { path: '/design-system', element: <DesignSystemRoute /> },
]);
