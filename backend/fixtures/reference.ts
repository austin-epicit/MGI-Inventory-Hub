import type {
	Cin7Customer,
	Cin7Location,
	Cin7Me,
	Cin7PriceTier,
	Cin7Supplier,
} from "../src/cin7/schemas.js";
import { CUSTOMERS, LOCATIONS, SUPPLIERS, TIER_NAMES } from "./catalog.js";
import { slug, type GenContext } from "./context.js";

export type Reference = {
	me: Cin7Me;
	priceTiers: Cin7PriceTier[];
	locations: Cin7Location[];
	suppliers: Cin7Supplier[];
	customers: Cin7Customer[];
};

export function buildReference({ rng, stamp, randomDay }: GenContext): Reference {
	const me: Cin7Me = {
		Company: "MGI Fixture Co",
		Currency: "USD",
		TimeZone: "America/Los_Angeles",
	};
	const priceTiers: Cin7PriceTier[] = Array.from({ length: 10 }, (_, i) => ({
		Code: i + 1,
		Name: i < 3 ? TIER_NAMES[i] : `Tier ${i + 1}`,
	}));
	const locations: Cin7Location[] = LOCATIONS.map((Name, i) => ({
		ID: rng.guid(),
		Name,
		IsDefault: i === 0,
		IsDeprecated: false,
		AllowReorder: false,
		Bins: [],
		FixedAssetsLocation: false,
		ParentID: null,
		ParentName: null,
		PickZones: null,
		IsShopfloor: false,
		IsCoMan: false,
		IsStaging: false,
	}));

	const address = (type: string) => ({
		Line1: `${rng.int(100, 9900)} Fixture Way`,
		Line2: "",
		City: "Portland",
		State: "OR",
		Postcode: "97201",
		Country: "United States",
		Type: type,
		DefaultForType: true,
	});
	const contact = (name: string) => ({
		Name: name,
		Phone: "",
		MobilePhone: null,
		Fax: null,
		Email: `${slug(name).toLowerCase()}@example.invalid`,
		Website: null,
		Default: true,
		Comment: null,
		IncludeInEmail: false,
	});

	const suppliers: Cin7Supplier[] = SUPPLIERS.map((s) => ({
		ID: rng.guid(),
		Name: s.name,
		Currency: s.currency,
		PaymentTerm: "30 days",
		TaxRule: "Tax Exempt",
		Discount: 0,
		Comments: null,
		AccountPayable: "800",
		TaxNumber: null,
		AttributeSet: null,
		Status: "Active",
		LastModifiedOn: stamp(randomDay()),
		Addresses: [address("Business")],
		Contacts: [contact("Accounts Payable")],
	}));

	// Fixed tier per customer so the 60/30/10 sale mix is exact in expectation and every
	// tier has foreign-currency customers to exercise conversion.
	const customerTier = CUSTOMERS.map((_, i) =>
		i === 22 || i === 24
			? "Wholesale"
			: i === 23
				? "Retail"
				: i < 13
					? "Wholesale"
					: i < 19
						? "Retail"
						: "Broker"
	);
	const customers: Cin7Customer[] = CUSTOMERS.map((c, i) => ({
		ID: rng.guid(),
		Name: c.name,
		DisplayName: c.name,
		Currency: c.currency,
		PaymentTerm: "30 days",
		Discount: 0,
		TaxRule: "Tax Exempt",
		SalesRepresentative: null,
		Location: "Main Warehouse",
		Comments: null,
		PriceTier: customerTier[i],
		Status: "Active",
		LastModifiedOn: stamp(randomDay()),
		Addresses: [address("Billing")],
		Contacts: [contact("Purchasing")],
	}));

	return { me, priceTiers, locations, suppliers, customers };
}
