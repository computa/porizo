import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';

function App() {
  return (
    <BrowserRouter basename="/admin">
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          {/* Future routes */}
          <Route path="/users" element={<Placeholder title="Users" />} />
          <Route path="/jobs" element={<Placeholder title="Jobs" />} />
          <Route path="/dlq" element={<Placeholder title="Dead Letter Queue" />} />
          <Route path="/moderation" element={<Placeholder title="Moderation" />} />
          <Route path="/billing" element={<Placeholder title="Billing" />} />
          <Route path="/shares" element={<Placeholder title="Shares" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

// Temporary placeholder for unimplemented pages
function Placeholder({ title }: { title: string }) {
  return (
    <div className="card rounded-xl p-8 text-center">
      <h1 className="text-2xl font-bold text-white mb-2">{title}</h1>
      <p className="text-slate-400">Coming in Phase 3-6</p>
    </div>
  );
}

export default App;
