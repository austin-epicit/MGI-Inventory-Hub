import { PRICE_RANGE_OPTIONS } from "../../components/charts/costPriceSeries";
import PageHeader from "../../components/ui/PageHeader";
import SegmentedToggle from "../../components/ui/SegmentedToggle";
import BreakdownCard from "./BreakdownCard";
import CategoryMixCard from "./CategoryMixCard";
import { useInsightsParams } from "./hooks";
import SlowMoversCard from "./SlowMoversCard";
import StockAgeCard from "./StockAgeCard";
import StockValueCard from "./StockValueCard";
import TopProductsCard from "./TopProductsCard";
import TrendCard from "./TrendCard";

export default function InsightsPage() {
	const { range, setRange, by, setBy } = useInsightsParams();

	return (
		<div className="text-text-primary">
			<PageHeader
				title="Insights"
				subtitle={
					<span className="text-xs text-text-muted">
						Sales are counted orders before credit notes.
					</span>
				}
			>
				<SegmentedToggle
					ariaLabel="Date range"
					value={range}
					options={PRICE_RANGE_OPTIONS}
					onChange={setRange}
				/>
			</PageHeader>
			<div className="space-y-4">
				<TrendCard range={range} />
				<CategoryMixCard range={range} />
				<BreakdownCard range={range} by={by} onByChange={setBy} />
				<TopProductsCard range={range} />
				<div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
					<StockValueCard />
					<StockAgeCard />
					<SlowMoversCard />
				</div>
			</div>
		</div>
	);
}
