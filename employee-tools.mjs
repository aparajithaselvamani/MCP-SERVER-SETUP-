import { employees } from "./mongo-store.mjs";

export const APPROVED_TOOL_NAMES = new Set([
  "list_employees",
  "search_employee",
  "get_employee_salary",
  "get_employee_department",
  "employees_by_department",
  "highest_salary",
  "lowest_salary",
  "average_salary",
  "employee_count",
  "salary_difference",
  "average_salary_by_department",
  "highest_paid_department",
  "employee_count_by_department",
  "highest_paid_employee_in_department",
  "lowest_paid_employee_in_department",
  "compare_employee_salary",
  "employees_above_average_salary",
  "department_with_most_employees",
  "employees_by_department_sorted_by_salary",
  "department_payroll",
  "highest_payroll_department",
  "lowest_payroll_department",
  "top_n_highest_paid_employees",
  "bottom_n_lowest_paid_employees",
  "salary_range_search",
  "median_salary",
  "salary_statistics",
  "department_salary_statistics"
]);

export async function executeEmployeeTool(tool, input = {}) {
  if (!APPROVED_TOOL_NAMES.has(tool)) {
    throw new Error(`Tool is not approved: ${tool}`);
  }

  const handlers = {
    list_employees,
    search_employee,
    get_employee_salary,
    get_employee_department,
    employees_by_department,
    highest_salary,
    lowest_salary,
    average_salary,
    employee_count,
    salary_difference,
    average_salary_by_department,
    highest_paid_department,
    employee_count_by_department,
    highest_paid_employee_in_department,
    lowest_paid_employee_in_department,
    compare_employee_salary,
    employees_above_average_salary,
    department_with_most_employees,
    employees_by_department_sorted_by_salary,
    department_payroll,
    highest_payroll_department,
    lowest_payroll_department,
    top_n_highest_paid_employees,
    bottom_n_lowest_paid_employees,
    salary_range_search,
    median_salary,
    salary_statistics,
    department_salary_statistics
  };

  return handlers[tool](input);
}

export function formatToolResult(result) {
  if (Array.isArray(result)) {
    return result.map(formatOne).join("\n");
  }
  return formatOne(result);
}

async function list_employees({ limit = 25 } = {}) {
  const rows = await employees()
    .find({}, { projection: employeeProjection() })
    .sort({ name: 1 })
    .limit(Math.min(Number(limit) || 25, 50))
    .toArray();
  return rows.map(cleanEmployee);
}

async function search_employee(input) {
  const text = requireText(input.query ?? input.employee ?? input.name, "query");
  const rows = await employees()
    .find({ name: { $regex: escapeRegex(text), $options: "i" } }, { projection: employeeProjection() })
    .sort({ name: 1 })
    .limit(20)
    .toArray();
  return rows.map(cleanEmployee);
}

async function get_employee_salary(input) {
  const employee = await findEmployeeByName(input.employee ?? input.name ?? input.employee_name);
  if (!employee) return { error: "employee_not_found" };
  return { name: employee.name, salary: employee.salary };
}

async function get_employee_department(input) {
  const employee = await findEmployeeByName(input.employee ?? input.name ?? input.employee_name);
  if (!employee) return { error: "employee_not_found" };
  return { name: employee.name, department: employee.department };
}

async function employees_by_department(input) {
  const department = requireText(input.department, "department");
  const rows = await employees()
    .find({ department: regexExact(department) }, { projection: employeeProjection() })
    .sort({ name: 1 })
    .limit(50)
    .toArray();
  return rows.map(cleanEmployee);
}

async function highest_salary() {
  return cleanEmployee(
    await employees().findOne({}, { projection: employeeProjection(), sort: { salary: -1, name: 1 } })
  );
}

async function lowest_salary() {
  return cleanEmployee(
    await employees().findOne({}, { projection: employeeProjection(), sort: { salary: 1, name: 1 } })
  );
}

async function average_salary() {
  const [row] = await employees()
    .aggregate([{ $group: { _id: null, averageSalary: { $avg: "$salary" } } }])
    .toArray();
  return { averageSalary: round(row?.averageSalary ?? 0) };
}

async function employee_count(input = {}) {
  const filter = input.department ? { department: regexExact(input.department) } : {};
  return { count: await employees().countDocuments(filter), department: input.department ?? null };
}

async function salary_difference(input = {}) {
  const first = input.first_employee ?? input.employee1 ?? input.first;
  const second = input.second_employee ?? input.employee2 ?? input.second;

  if (first && second) {
    const firstEmployee = await findEmployeeByName(first);
    const secondEmployee = await findEmployeeByName(second);
    if (!firstEmployee || !secondEmployee) return { error: "employee_not_found" };
    return {
      first: { name: firstEmployee.name, salary: firstEmployee.salary },
      second: { name: secondEmployee.name, salary: secondEmployee.salary },
      difference: Math.abs(firstEmployee.salary - secondEmployee.salary)
    };
  }

  const highest = await highest_salary();
  const lowest = await lowest_salary();
  return {
    highest,
    lowest,
    difference: Math.abs(highest.salary - lowest.salary)
  };
}

async function average_salary_by_department(input = {}) {
  const match = input.department ? [{ $match: { department: regexExact(input.department) } }] : [];
  const rows = await employees()
    .aggregate([
      ...match,
      { $group: { _id: "$department", averageSalary: { $avg: "$salary" } } },
      { $project: { _id: 0, department: "$_id", averageSalary: { $round: ["$averageSalary", 2] } } },
      { $sort: { averageSalary: -1, department: 1 } }
    ])
    .toArray();
  return input.department ? rows[0] ?? { error: "department_not_found" } : rows;
}

async function highest_paid_department() {
  const [row] = await employees()
    .aggregate([
      { $group: { _id: "$department", averageSalary: { $avg: "$salary" } } },
      { $sort: { averageSalary: -1 } },
      { $limit: 1 },
      { $project: { _id: 0, department: "$_id", averageSalary: { $round: ["$averageSalary", 2] } } }
    ])
    .toArray();
  return row ?? { error: "no_employees" };
}

async function employee_count_by_department(input) {
  const department = requireText(input.department, "department");
  return {
    department,
    count: await employees().countDocuments({ department: regexExact(department) })
  };
}

async function highest_paid_employee_in_department(input) {
  const department = requireText(input.department, "department");
  return cleanEmployee(
    await employees().findOne(
      { department: regexExact(department) },
      { projection: employeeProjection(), sort: { salary: -1, name: 1 } }
    )
  );
}

async function lowest_paid_employee_in_department(input) {
  const department = requireText(input.department, "department");
  return cleanEmployee(
    await employees().findOne(
      { department: regexExact(department) },
      { projection: employeeProjection(), sort: { salary: 1, name: 1 } }
    )
  );
}

async function compare_employee_salary(input) {
  return salary_difference(input);
}

async function employees_above_average_salary() {
  const avg = await average_salary();
  const rows = await employees()
    .find({ salary: { $gt: avg.averageSalary } }, { projection: employeeProjection() })
    .sort({ salary: -1, name: 1 })
    .limit(50)
    .toArray();
  return {
    averageSalary: avg.averageSalary,
    employees: rows.map(cleanEmployee)
  };
}

async function department_with_most_employees() {
  const [row] = await employees()
    .aggregate([
      { $group: { _id: "$department", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 1 },
      { $project: { _id: 0, department: "$_id", count: 1 } }
    ])
    .toArray();
  return row ?? { error: "no_employees" };
}

async function employees_by_department_sorted_by_salary(input) {
  const department = requireText(input.department, "department");
  const direction = String(input.direction ?? "desc").toLowerCase() === "asc" ? 1 : -1;
  const rows = await employees()
    .find({ department: regexExact(department) }, { projection: employeeProjection() })
    .sort({ salary: direction, name: 1 })
    .limit(50)
    .toArray();
  return rows.map(cleanEmployee);
}

async function department_payroll(input) {
  const department = requireText(input.department, "department");
  const [row] = await employees()
    .aggregate([
      { $match: { department: regexExact(department) } },
      { $group: { _id: "$department", payroll: { $sum: "$salary" }, employeeCount: { $sum: 1 } } },
      { $project: { _id: 0, department: "$_id", payroll: 1, employeeCount: 1 } }
    ])
    .toArray();
  return row ?? { error: "department_not_found" };
}

async function highest_payroll_department() {
  const [row] = await departmentPayrollRows({ direction: -1, limit: 1 });
  return row ?? { error: "no_employees" };
}

async function lowest_payroll_department() {
  const [row] = await departmentPayrollRows({ direction: 1, limit: 1 });
  return row ?? { error: "no_employees" };
}

async function top_n_highest_paid_employees(input = {}) {
  return employeesBySalaryRank(input, -1);
}

async function bottom_n_lowest_paid_employees(input = {}) {
  return employeesBySalaryRank(input, 1);
}

async function salary_range_search(input) {
  const minSalary = Number(input.min_salary ?? input.min ?? 0);
  const maxSalary = Number(input.max_salary ?? input.max ?? Number.MAX_SAFE_INTEGER);
  const rows = await employees()
    .find({ salary: { $gte: minSalary, $lte: maxSalary } }, { projection: employeeProjection() })
    .sort({ salary: -1, name: 1 })
    .limit(Math.min(Number(input.limit) || 50, 100))
    .toArray();
  return {
    minSalary,
    maxSalary,
    employees: rows.map(cleanEmployee)
  };
}

async function median_salary() {
  const values = await employees()
    .find({}, { projection: { _id: 0, salary: 1 } })
    .sort({ salary: 1 })
    .toArray();
  return { medianSalary: median(values.map((row) => row.salary)) };
}

async function salary_statistics() {
  const [stats] = await employees()
    .aggregate([
      {
        $group: {
          _id: null,
          employeeCount: { $sum: 1 },
          averageSalary: { $avg: "$salary" },
          minSalary: { $min: "$salary" },
          maxSalary: { $max: "$salary" },
          payroll: { $sum: "$salary" }
        }
      },
      {
        $project: {
          _id: 0,
          employeeCount: 1,
          averageSalary: { $round: ["$averageSalary", 2] },
          minSalary: 1,
          maxSalary: 1,
          payroll: 1
        }
      }
    ])
    .toArray();
  return { ...(stats ?? {}), ...(await median_salary()) };
}

async function department_salary_statistics(input = {}) {
  const match = input.department ? [{ $match: { department: regexExact(input.department) } }] : [];
  const rows = await employees()
    .aggregate([
      ...match,
      {
        $group: {
          _id: "$department",
          employeeCount: { $sum: 1 },
          averageSalary: { $avg: "$salary" },
          minSalary: { $min: "$salary" },
          maxSalary: { $max: "$salary" },
          payroll: { $sum: "$salary" }
        }
      },
      {
        $project: {
          _id: 0,
          department: "$_id",
          employeeCount: 1,
          averageSalary: { $round: ["$averageSalary", 2] },
          minSalary: 1,
          maxSalary: 1,
          payroll: 1
        }
      },
      { $sort: { department: 1 } }
    ])
    .toArray();
  return input.department ? rows[0] ?? { error: "department_not_found" } : rows;
}

async function departmentPayrollRows({ direction, limit }) {
  return employees()
    .aggregate([
      { $group: { _id: "$department", payroll: { $sum: "$salary" }, employeeCount: { $sum: 1 } } },
      { $project: { _id: 0, department: "$_id", payroll: 1, employeeCount: 1 } },
      { $sort: { payroll: direction, department: 1 } },
      { $limit: limit }
    ])
    .toArray();
}

async function employeesBySalaryRank(input, direction) {
  const limit = Math.min(Number(input.limit ?? input.n) || 10, 100);
  const rows = await employees()
    .find({}, { projection: employeeProjection() })
    .sort({ salary: direction, name: 1 })
    .limit(limit)
    .toArray();
  return rows.map(cleanEmployee);
}

async function findEmployeeByName(name) {
  const text = requireText(name, "employee");
  return employees().findOne({ name: { $regex: escapeRegex(text), $options: "i" } }, { projection: employeeProjection() });
}

function employeeProjection() {
  return { _id: 0, name: 1, department: 1, salary: 1, age: 1, city: 1, remote: 1, joiningDate: 1 };
}

function cleanEmployee(employee) {
  if (!employee) return { error: "employee_not_found" };
  return {
    name: employee.name,
    department: employee.department,
    salary: employee.salary,
    age: employee.age,
    city: employee.city
  };
}

function formatOne(value) {
  if (!value || typeof value !== "object") return String(value ?? "");
  return Object.entries(value)
    .map(([key, val]) => `${key}: ${Array.isArray(val) ? val.map(formatOne).join("; ") : val}`)
    .join(" | ");
}

function requireText(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function regexExact(value) {
  return { $regex: `^${escapeRegex(String(value).trim())}$`, $options: "i" };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

function median(values) {
  if (values.length === 0) return 0;
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[middle];
  return round((values[middle - 1] + values[middle]) / 2);
}
