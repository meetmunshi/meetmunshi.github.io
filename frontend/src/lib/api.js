import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;
export const api = axios.create({ baseURL: API });

export const fetchPersons = () => api.get("/persons").then((r) => r.data);
export const fetchLines = () => api.get("/lines").then((r) => r.data);
export const fetchDetails = () => api.get("/details").then((r) => r.data);
export const fetchStats = () => api.get("/stats").then((r) => r.data);
export const fetchSchedule = (date, shift = "day") =>
    api.get(`/schedule/${date}`, { params: { shift } }).then((r) => r.data);
export const fetchSchedules = () => api.get("/schedules").then((r) => r.data);
export const generateSchedule = (payload) =>
    api.post("/schedule", payload).then((r) => r.data);
export const adjustCell = (date, payload) =>
    api.post(`/schedule/${date}/adjust`, payload).then((r) => r.data);
export const uploadExcel = (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post("/upload-excel", fd, {
        headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data);
};
export const exportScheduleUrl = (date, shift = "day") =>
    `${API}/export/${date}?shift=${shift}`;
export const fetchShortageAnalytics = (days = 30) =>
    api.get("/analytics/shortage", { params: { days } }).then((r) => r.data);
