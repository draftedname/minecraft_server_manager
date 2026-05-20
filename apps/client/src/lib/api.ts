// MC Server GUI
import axios from "axios";

const api = axios.create({
  baseURL: "/api",
});

export default api;

