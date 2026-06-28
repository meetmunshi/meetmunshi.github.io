import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API });

export const fetchPersons = () => api.get("/persons").then((r) => r.data);
export const fetchLines = () => api.get("/lines").then((r) => r.data);
export const fetchDetails = () => api.get("/details").then((r) => r.data);
export const fetchStats = () => api.get("/stats").then((r) => r.data);
export const fetchSchedule = (date) =>
    api.get(`/schedule/${date}`).then((r) => r.data);
export const fetchSchedules = () =>
    api.get("/schedules").then((r) => r.data);
export const generateSchedule = (payload) =>
    api.post("/schedule", payload).then((r) => r.data);
export const uploadExcel = (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return api
        .post("/upload-excel", fd, {
            headers: { "Content-Type": "multipart/form-data" },
        })
        .then((r) => r.data);
};
export const exportScheduleUrl = (date) => `${API}/export/${date}`;
