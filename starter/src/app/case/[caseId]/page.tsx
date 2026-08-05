import { InvestigationExperience } from "@/components/investigation/InvestigationExperience";
import { mockCase } from "@/lib/mock-case";

export default async function CasePage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ curiosity?: string }>;
}) {
  const { caseId } = await params;
  const { curiosity } = await searchParams;

  return (
    <InvestigationExperience
      investigation={{
        ...mockCase,
        id: caseId,
        curiosity: curiosity ?? mockCase.curiosity,
      }}
    />
  );
}
