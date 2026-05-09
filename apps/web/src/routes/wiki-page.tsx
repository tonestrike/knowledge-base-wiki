import { mockWikiPage } from '@package/contracts/wiki';
import { WikiPageView } from '../components/wiki-page/wiki-page.tsx';

export function WikiPageRoute() {
  const page = mockWikiPage();
  return <WikiPageView page={page} />;
}
