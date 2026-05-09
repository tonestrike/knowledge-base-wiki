import { RouterProvider } from 'react-router-dom';
import { CitationFlightProvider } from './components/citation/use-citation-flight.tsx';
import { router } from './router.tsx';

export function App() {
  return (
    <CitationFlightProvider>
      <RouterProvider router={router} />
    </CitationFlightProvider>
  );
}
