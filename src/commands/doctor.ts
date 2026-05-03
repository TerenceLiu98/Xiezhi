import { runDoctor } from "../services/doctor-service.js"

export async function runDoctorCommand(cwd: string) {
  return runDoctor(cwd)
}
