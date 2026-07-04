import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { LibraryPage } from './pages/LibraryPage';
import { ItemPage } from './pages/ItemPage';
import { BrowsePage } from './pages/BrowsePage';
import { CollectionsPage } from './pages/CollectionsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ReaderPage } from './pages/ReaderPage';

export default function App() {
  return (
    <Routes>
      {/* Full-screen reader is outside the main layout. */}
      <Route path="/item/:id/read" element={<ReaderPage />} />

      <Route element={<Layout />}>
        <Route path="/" element={<LibraryPage title="Wszystko" />} />
        <Route path="/ebooks" element={<LibraryPage kind="ebook" title="E-booki" />} />
        <Route path="/audiobooks" element={<LibraryPage kind="audiobook" title="Audiobooki" />} />
        <Route path="/reading" element={<LibraryPage status="reading" title="W trakcie" />} />
        <Route path="/authors" element={<BrowsePage kind="authors" />} />
        <Route path="/series" element={<BrowsePage kind="series" />} />
        <Route path="/collections" element={<CollectionsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/item/:id" element={<ItemPage />} />
        <Route path="*" element={<LibraryPage title="Wszystko" />} />
      </Route>
    </Routes>
  );
}
