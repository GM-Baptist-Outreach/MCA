import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import Index from "./pages/Index";
import OurStory from "./pages/OurStory";
import OurApproach from "./pages/OurApproach";
import Enroll from "./pages/Enroll";
import CurriculumGuide from "./pages/CurriculumGuide";
import Contact from "./pages/Contact";
import NotFound from "./pages/NotFound";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminEnrollments from "./pages/admin/AdminEnrollments";
import AdminOrders from "./pages/admin/AdminOrders";
import AdminPlans from "./pages/admin/AdminPlans";
import AdminInventory from "./pages/admin/AdminInventory";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminFamilies from "./pages/admin/AdminFamilies";
import AdminCompEnroll from "./pages/admin/AdminCompEnroll";
import AdminFamilyDetail from "./pages/admin/AdminFamilyDetail";
import AdminTranscript from "./pages/admin/AdminTranscript";
import AdminAcademicProjection from "./pages/admin/AdminAcademicProjection";
import AdminPickLists from "./pages/admin/AdminPickLists";
import Store from "./pages/Store";
import PortalLogin from "./pages/portal/PortalLogin";
import PortalLayout from "./pages/portal/PortalLayout";
import PortalHome from "./pages/portal/PortalHome";
import PortalProgress from "./pages/portal/PortalProgress";
import PortalPaceStatus from "./pages/portal/PortalPaceStatus";
import PortalForms from "./pages/portal/PortalForms";
import PortalEnrollmentAgreement from "./pages/portal/forms/PortalEnrollmentAgreement";
import PortalRecordsRelease from "./pages/portal/forms/PortalRecordsRelease";
import PortalHonestyPolicy from "./pages/portal/forms/PortalHonestyPolicy";
import PortalGoalCard from "./pages/portal/forms/PortalGoalCard";
import PortalPeLog from "./pages/portal/forms/PortalPeLog";
import PortalMusicVerification from "./pages/portal/forms/PortalMusicVerification";
import PortalCourseVerification from "./pages/portal/forms/PortalCourseVerification";
import PortalSupervisorReport from "./pages/portal/PortalSupervisorReport";
import PortalStudentReport from "./pages/portal/PortalStudentReport";
import PortalStarChart from "./pages/portal/PortalStarChart";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Index />} />
            <Route path="/our-story" element={<OurStory />} />
            <Route path="/our-approach" element={<OurApproach />} />
            <Route path="/enroll" element={<Enroll />} />
            <Route path="/curriculum-guide" element={<CurriculumGuide />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/store" element={<Store />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="enrollments" replace />} />
            <Route path="enrollments" element={<AdminEnrollments />} />
            <Route path="orders" element={<AdminOrders />} />
            <Route path="plans" element={<AdminPlans />} />
            <Route path="inventory" element={<AdminInventory />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="families" element={<AdminFamilies />} />
            <Route path="enroll-comp" element={<AdminCompEnroll />} />
            <Route path="families/:familyId" element={<AdminFamilyDetail />} />
            <Route path="pick-lists" element={<AdminPickLists />} />
            <Route
              path="families/:familyId/students/:studentId/transcript"
              element={<AdminTranscript />}
            />
            <Route
              path="families/:familyId/students/:studentId/projection"
              element={<AdminAcademicProjection />}
            />
          </Route>
          <Route path="/portal/login" element={<PortalLogin />} />
          <Route path="/portal" element={<PortalLayout />}>
            <Route index element={<PortalHome />} />
            <Route path="progress" element={<PortalProgress />} />
            <Route path="pace-status" element={<PortalPaceStatus />} />
            <Route path="supervisor-report" element={<PortalSupervisorReport />} />
            <Route path="student-report" element={<PortalStudentReport />} />
            <Route path="star-chart" element={<PortalStarChart />} />
            <Route path="forms" element={<PortalForms />} />
            <Route
              path="forms/enrollment-agreement"
              element={<PortalEnrollmentAgreement />}
            />
            <Route
              path="forms/records-release"
              element={<PortalRecordsRelease />}
            />
            <Route
              path="forms/honesty-policy"
              element={<PortalHonestyPolicy />}
            />
            <Route path="forms/goal-card" element={<PortalGoalCard />} />
            <Route path="forms/pe-log" element={<PortalPeLog />} />
            <Route
              path="forms/music-verification"
              element={<PortalMusicVerification />}
            />
            <Route
              path="forms/course-verification"
              element={<PortalCourseVerification />}
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
