import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { Enrollment } from './pages/Enrollment';
import { Pipeline } from './pages/Pipeline';
import { Jobs } from './pages/Jobs';
import { DLQ } from './pages/DLQ';
import { Users } from './pages/Users';
import { Moderation } from './pages/Moderation';
import { Billing } from './pages/Billing';
import { Growth } from './pages/Growth';
import { Shares } from './pages/Shares';
import { Story } from './pages/Story';
import { SystemHealth } from './pages/security/SystemHealth';
import { SecurityLogs } from './pages/security/SecurityLogs';
import { AuditLogs } from './pages/security/AuditLogs';
import { ConsentLogs } from './pages/security/ConsentLogs';
import { RateLimits } from './pages/security/RateLimits';
import { SecurityConfig } from './pages/security/SecurityConfig';
import { STTConfig } from './pages/settings/STTConfig';
import { FeatureFlagsConfig } from './pages/settings/FeatureFlagsConfig';

function App() {
  return (
    <BrowserRouter basename="/admin">
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="/enrollment" element={<Enrollment />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/users" element={<Users />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/dlq" element={<DLQ />} />
          <Route path="/moderation" element={<Moderation />} />
          <Route path="/story" element={<Story />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/growth" element={<Growth />} />
          <Route path="/shares" element={<Shares />} />
          {/* Security Section */}
          <Route path="/security/health" element={<SystemHealth />} />
          <Route path="/security/auth-logs" element={<SecurityLogs />} />
          <Route path="/security/audit" element={<AuditLogs />} />
          <Route path="/security/consent" element={<ConsentLogs />} />
          <Route path="/security/rate-limits" element={<RateLimits />} />
          <Route path="/security/config" element={<SecurityConfig />} />
          <Route path="/settings/stt" element={<STTConfig />} />
          <Route path="/settings/feature-flags" element={<FeatureFlagsConfig />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
