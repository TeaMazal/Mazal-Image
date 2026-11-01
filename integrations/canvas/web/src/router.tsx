import { createBrowserRouter, Navigate, Outlet, useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import CanvasProjectPage from "@/pages/canvas/project";
import { SouhubLayout, SouhubProjects, SouhubAssets, SouhubJobs, SouhubAdmin } from "@/components/souhub-workspace";
function Project() {
 const { id } = useParams();
 const navigate = useNavigate();
 const [revision, setRevision] = useState(0);
 useEffect(() => { const reload = (event: Event) => { const detail = (event as CustomEvent<{ids:string[];copies:{from:string;to:string}[]}>).detail; const copy = detail.copies.find((item) => item.from === id); if (copy) navigate('/canvas/' + copy.to, {replace:true}); if (detail.ids.includes(id || '')) setRevision((value) => value + 1); }; window.addEventListener("souhub-projects-loaded", reload); return () => window.removeEventListener("souhub-projects-loaded", reload); }, [id, navigate]);
 return <CanvasProjectPage key={revision} />;
}
export const router = createBrowserRouter([{ element: <SouhubLayout><Outlet /></SouhubLayout>, children: [
 { path: "/", element: <Navigate to="/canvas" replace /> },
 { path: "/canvas", element: <SouhubProjects /> },
 { path: "/canvas/:id", element: <Project /> },
 { path: "/library", element: <SouhubAssets /> },
 { path: "/jobs", element: <SouhubJobs /> },
 { path: "/admin", element: <SouhubAdmin /> },
 { path: "*", element: <Navigate to="/canvas" replace /> },
]}], { basename: "/canvas" });
