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
export const deleteSchedule = (date, shift = "day") =>
    api.delete(`/schedule/${date}`, { params: { shift } }).then((r) => r.data);
export const generateSchedule = (payload) =>
    api.post("/schedule", payload).then((r) => r.data);
export const adjustCell = (date, payload) =>
    api.post(`/schedule/${date}/adjust`, payload).then((r) => r.data);
export const markAbsentFromBoard = (date, payload) =>
    api.post(`/schedule/${date}/mark-absent`, payload).then((r) => r.data);
export const logSchedule = (date, shift = "day") =>
    api.post(`/schedule/${date}/log`, null, { params: { shift } }).then((r) => r.data);
export const absenteeismReportUrl = (start, end, onlyLogged = false) =>
    `${API}/reports/absenteeism?start=${start}&end=${end}&only_logged=${onlyLogged}`;
export const suggestReplacement = (date, cellKey, shift = "day", top = 3) =>
    api.get(`/schedule/${date}/suggest-replacement`, { params: { cell_key: cellKey, shift, top } }).then((r) => r.data);
export const lateArrival = (date, payload) =>
    api.post(`/schedule/${date}/late-arrival`, payload).then((r) => r.data);
export const undoLateArrival = (date, shift = "day") =>
    api.post(`/schedule/${date}/undo`, null, { params: { shift } }).then((r) => r.data);
export const fillShortages = (date, shift = "day") =>
    api.post(`/schedule/${date}/fill-shortages`, null, { params: { shift } }).then((r) => r.data);
export const previewFillShortages = (date, shift = "day") =>
    api.post(`/schedule/${date}/fill-shortages`, null, { params: { shift, preview: true } }).then((r) => r.data);
export const suggestLines = (date, shift = "day") =>
    api.get(`/schedule/${date}/suggest-lines`, { params: { shift } }).then((r) => r.data);
export const fetchAreas = () => api.get("/areas").then((r) => r.data);
export const setDisabledActivities = (date, payload) =>
    api.post(`/schedule/${date}/set-disabled-activities`, payload).then((r) => r.data);
export const closeLine = (date, payload) =>
    api.post(`/schedule/${date}/close-line`, payload).then((r) => r.data);
export const reopenLine = (date, payload) =>
    api.post(`/schedule/${date}/reopen-line`, payload).then((r) => r.data);
export const suggestLineToStart = (date, shift = "day") =>
    api.get(`/schedule/${date}/suggest-line`, { params: { shift } }).then((r) => r.data);
export const startLine = (date, payload) =>
    api.post(`/schedule/${date}/start-line`, payload).then((r) => r.data);
export const autoPlan = (payload) =>
    api.post("/schedule/auto-plan", payload).then((r) => r.data);
export const uploadExcel = (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post("/upload-excel", fd, {
        params: { confirm: true },
        headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data);
};
export const exportScheduleUrl = (date, shift = "day") =>
    `${API}/export/${date}?shift=${shift}`;
export const fetchMonthlyAnalytics = (month) =>
    api.get("/analytics/monthly", { params: month ? { month } : {} }).then((r) => r.data);
export const fetchShortageAnalytics = (days = 30) =>
    api.get("/analytics/shortage", { params: { days } }).then((r) => r.data);
