import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import SetupPage from "@/pages/SetupPage";
import BoardPage from "@/pages/BoardPage";
import PersonsPage from "@/pages/PersonsPage";
import UploadPage from "@/pages/UploadPage";

function App() {
    return (
        <div className="App">
            <BrowserRouter>
                <Routes>
                    <Route element={<AppLayout />}>
                        <Route path="/" element={<SetupPage />} />
                        <Route path="/board" element={<BoardPage />} />
                        <Route path="/persons" element={<PersonsPage />} />
                        <Route path="/upload" element={<UploadPage />} />
                    </Route>
                </Routes>
            </BrowserRouter>
        </div>
    );
}

export default App;
