import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { Jobs } from './pages/Jobs';
import { DLQ } from './pages/DLQ';
import { Users } from './pages/Users';
import { Moderation } from './pages/Moderation';
import { Billing } from './pages/Billing';
import { Shares } from './pages/Shares';

function App() {
  return (
    <BrowserRouter basename="/admin">
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="/users" element={<Users />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/dlq" element={<DLQ />} />
          <Route path="/moderation" element={<Moderation />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/shares" element={<Shares />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
