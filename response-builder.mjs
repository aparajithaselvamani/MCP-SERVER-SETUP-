import { summarizeExecutionResults } from "./ai-provider.mjs";
import { formatToolResult } from "./employee-tools.mjs";

const DEBUG = (process.env.DEBUG_LOGS ?? "true").toLowerCase() === "true";

export async function buildFinalResponse(question, plan, execution) {
  try {
    return await summarizeExecutionResults(question, plan, execution.results);
  } catch {
    return fallbackResponse(question, execution.results);
  }
}

function fallbackResponse(question, results) {
  const q = question.toLowerCase();
  const byTool = new Map(results.map((step) => [step.tool, step.result]));

  if (byTool.has("highest_salary") && byTool.has("get_employee_department")) {
    const employee = byTool.get("highest_salary");
    const department = byTool.get("get_employee_department");
    return `${employee.name} has the highest salary (${money(employee.salary)}) and works in ${department.department}.`;
  }

  if (byTool.has("highest_paid_department") && byTool.has("employee_count_by_department")) {
    const department = byTool.get("highest_paid_department");
    const count = byTool.get("employee_count_by_department");
    return `${department.department} has the highest average salary (${money(department.averageSalary)}) and has ${count.count} employees.`;
  }

  if (byTool.has("highest_paid_department") && byTool.has("highest_paid_employee_in_department")) {
    const department = byTool.get("highest_paid_department");
    const employee = byTool.get("highest_paid_employee_in_department");
    return `${department.department} has the highest average salary (${money(department.averageSalary)}). The highest paid employee there is ${employee.name}, earning ${money(employee.salary)}.`;
  }

  if (byTool.has("department_with_most_employees") && byTool.has("average_salary_by_department")) {
    const department = byTool.get("department_with_most_employees");
    const average = byTool.get("average_salary_by_department");
    return `${department.department} has the most employees (${department.count}) and an average salary of ${money(average.averageSalary)}.`;
  }

  if (byTool.has("compare_employee_salary")) {
    const comparison = byTool.get("compare_employee_salary");
    if (comparison.error) return "I could not find one of those employees.";
    const higher =
      comparison.first.salary >= comparison.second.salary ? comparison.first : comparison.second;
    return `${higher.name} earns more. The salary difference is ${money(comparison.difference)}.`;
  }

  if (byTool.has("salary_difference")) {
    const diff = byTool.get("salary_difference");
    return `The salary difference is ${money(diff.difference)}.`;
  }

  if (byTool.has("highest_salary")) {
    const employee = byTool.get("highest_salary");
    return `${employee.name} has the highest salary: ${money(employee.salary)} in ${employee.department}.`;
  }

  if (byTool.has("lowest_salary")) {
    const employee = byTool.get("lowest_salary");
    return `${employee.name} has the lowest salary: ${money(employee.salary)} in ${employee.department}.`;
  }

  if (byTool.has("average_salary")) {
    return `The company average salary is ${money(byTool.get("average_salary").averageSalary)}.`;
  }

  if (byTool.has("median_salary")) {
    return `The median salary is ${money(byTool.get("median_salary").medianSalary)}.`;
  }

  if (byTool.has("salary_statistics")) {
    const stats = byTool.get("salary_statistics");
    return `Salary statistics: average ${money(stats.averageSalary)}, median ${money(stats.medianSalary)}, minimum ${money(stats.minSalary)}, maximum ${money(stats.maxSalary)}, total payroll ${money(stats.payroll)}.`;
  }

  if (byTool.has("department_salary_statistics")) {
    const stats = byTool.get("department_salary_statistics");
    if (Array.isArray(stats)) return formatList(stats, "Department salary statistics");
    return `${stats.department} salary statistics: average ${money(stats.averageSalary)}, minimum ${money(stats.minSalary)}, maximum ${money(stats.maxSalary)}, payroll ${money(stats.payroll)}.`;
  }

  if (byTool.has("highest_payroll_department")) {
    const department = byTool.get("highest_payroll_department");
    return `${department.department} spends the most on salaries with total payroll of ${money(department.payroll)}.`;
  }

  if (byTool.has("lowest_payroll_department")) {
    const department = byTool.get("lowest_payroll_department");
    return `${department.department} spends the least on salaries with total payroll of ${money(department.payroll)}.`;
  }

  if (byTool.has("department_payroll")) {
    const department = byTool.get("department_payroll");
    return `${department.department} has total payroll of ${money(department.payroll)} across ${department.employeeCount} employees.`;
  }

  if (byTool.has("department_with_most_employees")) {
    const department = byTool.get("department_with_most_employees");
    return `${department.department} has the most employees: ${department.count}.`;
  }

  if (byTool.has("employee_count")) {
    const count = byTool.get("employee_count");
    return count.department
      ? `${count.department} has ${count.count} employees.`
      : `There are ${count.count} employees.`;
  }

  if (byTool.has("average_salary_by_department")) {
    const result = byTool.get("average_salary_by_department");
    if (!Array.isArray(result)) {
      return `${result.department} has an average salary of ${money(result.averageSalary)}.`;
    }
    const top = result[0];
    if (q.includes("highest")) {
      return `${top.department} has the highest average salary: ${money(top.averageSalary)}.`;
    }
    return formatList(result.slice(0, 10), "Average salary by department");
  }

  const last = results.at(-1);
  return Array.isArray(last?.result)
    ? formatList(last.result.slice(0, 20), title(last.tool))
    : formatToolResult(last?.result);
}

function formatList(rows, titleText) {
  if (!rows || rows.length === 0) return "No matching employees found.";
  return [
    `${titleText}:`,
    ...rows.map((row) => `- ${formatToolResult(row)}`)
  ].join("\n");
}

function money(value) {
  const number = Number(value ?? 0);
  return `Rs. ${number.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function title(value) {
  return String(value).replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function debugPayload(question, plan, execution, response) {
  if (!DEBUG) return "";
  return JSON.stringify({ question, plan, execution, response }, null, 2);
}
