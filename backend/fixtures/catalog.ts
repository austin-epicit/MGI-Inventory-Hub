// Static reference data for the demo dataset: what MGI (a refurbished IT hardware dealer) would stock.
export const API_HOST = "cin7-fixture.invalid";
// A second host so Task 8 can prove auth headers are only sent to the API host.
export const FILES_HOST = "files-fixture.invalid";

export const CATEGORIES = ["Servers", "Storage", "Networking", "Components"] as const;
export type Category = (typeof CATEGORIES)[number];

export const LOCATIONS = ["Main Warehouse", "Refurb Bay", "Overflow"] as const;

export const TIER_NAMES = ["Retail", "Wholesale", "Broker"] as const;

export const SUPPLIERS: { name: string; currency: string }[] = [
	{ name: "Atlas Data Liquidators", currency: "USD" },
	{ name: "Blue Ridge IT Recovery", currency: "USD" },
	{ name: "Cascade Server Exchange", currency: "USD" },
	{ name: "Delta Reclaim Co", currency: "USD" },
	{ name: "Evergreen Surplus", currency: "USD" },
	{ name: "Frontier Tech Resale", currency: "USD" },
	{ name: "Granite Hardware Group", currency: "USD" },
	{ name: "Harbor Network Parts", currency: "USD" },
	{ name: "Ironwood Components", currency: "USD" },
	{ name: "Juniper Ridge Brokers", currency: "USD" },
	{ name: "Kestrel Storage Supply", currency: "USD" },
	{ name: "Maple Leaf Server Parts", currency: "CAD" },
];

export const CUSTOMERS: { name: string; currency: string }[] = [
	{ name: "Northwind Hosting", currency: "USD" },
	{ name: "Summit Cloud Services", currency: "USD" },
	{ name: "Redwood Analytics", currency: "USD" },
	{ name: "Pioneer School District", currency: "USD" },
	{ name: "Lakeside Medical Group", currency: "USD" },
	{ name: "Copperline Networks", currency: "USD" },
	{ name: "Alder Street Studios", currency: "USD" },
	{ name: "Beacon Credit Union", currency: "USD" },
	{ name: "Crescent Logistics", currency: "USD" },
	{ name: "Driftwood Software", currency: "USD" },
	{ name: "Eastgate Manufacturing", currency: "USD" },
	{ name: "Foxglove Labs", currency: "USD" },
	{ name: "Gateway Legal LLP", currency: "USD" },
	{ name: "Highland County IT", currency: "USD" },
	{ name: "Inlet Fisheries Co-op", currency: "USD" },
	{ name: "Juniper Street Retail", currency: "USD" },
	{ name: "Keystone Print Works", currency: "USD" },
	{ name: "Larkspur Design", currency: "USD" },
	{ name: "Meridian Telehealth", currency: "USD" },
	{ name: "Nightjar Games", currency: "USD" },
	{ name: "Orchard Valley Farms", currency: "USD" },
	{ name: "Pacific Rim Freight", currency: "USD" },
	{ name: "Prairie Wind Energy", currency: "CAD" },
	{ name: "Lakeshore Data Centres", currency: "CAD" },
	{ name: "Rhein Systemhaus", currency: "EUR" },
];

export type ModelTemplate = {
	category: Category;
	brand: string;
	model: string;
	// Typical refurbished unit cost in USD, grade A.
	cost: number;
};

export const MODELS: ModelTemplate[] = [
	{ category: "Servers", brand: "Dell", model: "PowerEdge R640", cost: 1450 },
	{ category: "Servers", brand: "Dell", model: "PowerEdge R740xd", cost: 2100 },
	{ category: "Servers", brand: "Dell", model: "PowerEdge R650", cost: 2900 },
	{ category: "Servers", brand: "Dell", model: "PowerEdge R440", cost: 780 },
	{ category: "Servers", brand: "HPE", model: "ProLiant DL360 Gen10", cost: 1320 },
	{ category: "Servers", brand: "HPE", model: "ProLiant DL380 Gen10", cost: 1680 },
	{ category: "Servers", brand: "HPE", model: "ProLiant DL325 Gen10 Plus", cost: 2400 },
	{ category: "Servers", brand: "HPE", model: "ProLiant ML350 Gen10", cost: 990 },
	{ category: "Servers", brand: "Lenovo", model: "ThinkSystem SR630", cost: 1250 },
	{ category: "Servers", brand: "Lenovo", model: "ThinkSystem SR650", cost: 1560 },
	{ category: "Servers", brand: "Supermicro", model: "SuperServer 1029U-TR4", cost: 940 },
	{ category: "Servers", brand: "Supermicro", model: "SuperServer 6029P-TRT", cost: 1180 },
	{ category: "Servers", brand: "Supermicro", model: "SuperServer 2029U-E1CR4", cost: 1390 },
	{ category: "Storage", brand: "NetApp", model: "FAS2750 Controller", cost: 4200 },
	{ category: "Storage", brand: "NetApp", model: "DS224C Shelf", cost: 1850 },
	{ category: "Storage", brand: "NetApp", model: "AFF A220 Controller", cost: 6800 },
	{ category: "Storage", brand: "NetApp", model: "DS4246 Shelf", cost: 620 },
	{ category: "Storage", brand: "Dell", model: "PowerVault ME4024", cost: 5100 },
	{ category: "Storage", brand: "HPE", model: "MSA 2060 Array", cost: 3900 },
	{ category: "Storage", brand: "Seagate", model: "Exos X18 16TB HDD", cost: 210 },
	{ category: "Storage", brand: "Seagate", model: "Exos 7E8 8TB HDD", cost: 105 },
	{ category: "Storage", brand: "Seagate", model: "Nytro 3350 1.6TB SSD", cost: 380 },
	{ category: "Storage", brand: "Samsung", model: "PM1643a 3.84TB SSD", cost: 540 },
	{ category: "Storage", brand: "Samsung", model: "PM883 960GB SSD", cost: 130 },
	{ category: "Storage", brand: "Samsung", model: "PM9A3 1.92TB NVMe", cost: 290 },
	{ category: "Networking", brand: "Cisco", model: "Catalyst 9300-48P", cost: 2300 },
	{ category: "Networking", brand: "Cisco", model: "Catalyst 2960X-48TS", cost: 360 },
	{ category: "Networking", brand: "Cisco", model: "Nexus 93180YC-EX", cost: 3100 },
	{ category: "Networking", brand: "Cisco", model: "ISR 4331 Router", cost: 780 },
	{ category: "Networking", brand: "Cisco", model: "ASA 5516-X Firewall", cost: 640 },
	{ category: "Networking", brand: "Juniper", model: "EX4300-48T", cost: 1050 },
	{ category: "Networking", brand: "Juniper", model: "QFX5100-48S", cost: 1900 },
	{ category: "Networking", brand: "Juniper", model: "SRX345 Firewall", cost: 880 },
	{ category: "Networking", brand: "Juniper", model: "MX204 Router", cost: 5400 },
	{ category: "Networking", brand: "Juniper", model: "EX2300-24T", cost: 310 },
	{ category: "Networking", brand: "Cisco", model: "Catalyst 9200L-24T", cost: 840 },
	{ category: "Networking", brand: "Cisco", model: "Meraki MS350-24", cost: 520 },
	{ category: "Components", brand: "Intel", model: "Xeon Gold 6248 CPU", cost: 520 },
	{ category: "Components", brand: "Intel", model: "Xeon Silver 4214 CPU", cost: 150 },
	{ category: "Components", brand: "Intel", model: "Xeon E5-2690 v4 CPU", cost: 70 },
	{ category: "Components", brand: "Intel", model: "X710-DA2 10GbE NIC", cost: 120 },
	{ category: "Components", brand: "Intel", model: "E810-XXVDA2 25GbE NIC", cost: 240 },
	{ category: "Components", brand: "Samsung", model: "32GB DDR4-2933 RDIMM", cost: 82 },
	{ category: "Components", brand: "Samsung", model: "64GB DDR4-2933 LRDIMM", cost: 160 },
	{ category: "Components", brand: "Samsung", model: "16GB DDR4-2666 RDIMM", cost: 38 },
	{ category: "Components", brand: "Dell", model: "PERC H730P RAID Card", cost: 95 },
	{ category: "Components", brand: "Dell", model: "750W Hot-Plug PSU", cost: 58 },
	{ category: "Components", brand: "HPE", model: "800W Flex Slot PSU", cost: 54 },
	{ category: "Components", brand: "HPE", model: "Smart Array P408i-a", cost: 88 },
	{ category: "Components", brand: "Lenovo", model: "930-8i RAID Adapter", cost: 76 },
	{ category: "Components", brand: "Supermicro", model: "X11DPH-T Motherboard", cost: 210 },
];

export const GRADES = [
	{ code: "A", label: "Grade A", costFactor: 1 },
	{ code: "B", label: "Grade B", costFactor: 0.82 },
	{ code: "OB", label: "Open Box", costFactor: 0.92 },
] as const;
