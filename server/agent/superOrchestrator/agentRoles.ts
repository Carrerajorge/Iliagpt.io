export type RiskLevel = "safe" | "moderate" | "dangerous" | "critical";
export type CostTier = "free" | "low" | "medium" | "high" | "premium";
export type AgentCategory =
  | "Research"
  | "Code"
  | "Data"
  | "Creative"
  | "Analysis"
  | "DevOps"
  | "Security"
  | "Communication"
  | "Planning"
  | "Domain";

export interface AgentRole {
  id: string;
  name: string;
  category: AgentCategory;
  description: string;
  capabilities: string[];
  riskLevel: RiskLevel;
  costTier: CostTier;
  requiredTools: string[];
}

const AGENT_ROLES: AgentRole[] = [
  { id: "research-web", name: "Web Researcher", category: "Research", description: "Searches the web for information, articles, and data sources", capabilities: ["web_search", "url_extraction", "content_summarization"], riskLevel: "safe", costTier: "low", requiredTools: ["web_search", "url_reader"] },
  { id: "research-academic", name: "Academic Researcher", category: "Research", description: "Searches academic databases, papers, and citations", capabilities: ["academic_search", "paper_analysis", "citation_tracking"], riskLevel: "safe", costTier: "medium", requiredTools: ["academic_search", "pdf_reader"] },
  { id: "research-market", name: "Market Researcher", category: "Research", description: "Analyzes market trends, competitors, and industry data", capabilities: ["market_analysis", "competitor_tracking", "trend_identification"], riskLevel: "safe", costTier: "medium", requiredTools: ["web_search", "data_aggregator"] },
  { id: "research-patent", name: "Patent Researcher", category: "Research", description: "Searches patent databases and analyzes intellectual property", capabilities: ["patent_search", "ip_analysis", "prior_art_review"], riskLevel: "safe", costTier: "medium", requiredTools: ["patent_search", "document_reader"] },
  { id: "research-news", name: "News Analyst", category: "Research", description: "Monitors and analyzes news sources for relevant information", capabilities: ["news_monitoring", "sentiment_analysis", "event_tracking"], riskLevel: "safe", costTier: "low", requiredTools: ["news_api", "web_search"] },
  { id: "research-social", name: "Social Media Researcher", category: "Research", description: "Analyzes social media trends and public sentiment", capabilities: ["social_monitoring", "trend_analysis", "influencer_identification"], riskLevel: "safe", costTier: "low", requiredTools: ["social_api", "sentiment_analyzer"] },
  { id: "research-legal", name: "Legal Researcher", category: "Research", description: "Searches legal databases, case law, and regulations", capabilities: ["legal_search", "case_analysis", "regulation_tracking"], riskLevel: "moderate", costTier: "high", requiredTools: ["legal_db", "document_reader"] },
  { id: "research-scientific", name: "Scientific Literature Reviewer", category: "Research", description: "Reviews scientific literature and synthesizes findings", capabilities: ["literature_review", "meta_analysis", "hypothesis_evaluation"], riskLevel: "safe", costTier: "medium", requiredTools: ["academic_search", "pdf_reader"] },
  { id: "research-competitive", name: "Competitive Intelligence Analyst", category: "Research", description: "Gathers and analyzes competitive intelligence data", capabilities: ["competitor_analysis", "swot_analysis", "benchmarking"], riskLevel: "moderate", costTier: "medium", requiredTools: ["web_search", "data_aggregator"] },
  { id: "research-fact-checker", name: "Fact Checker", category: "Research", description: "Verifies claims and statements against reliable sources", capabilities: ["fact_verification", "source_evaluation", "claim_analysis"], riskLevel: "safe", costTier: "low", requiredTools: ["web_search", "knowledge_base"] },

  { id: "code-generator", name: "Code Generator", category: "Code", description: "Generates code in multiple programming languages", capabilities: ["code_generation", "boilerplate_creation", "api_implementation"], riskLevel: "moderate", costTier: "medium", requiredTools: ["code_executor", "file_writer"] },
  { id: "code-reviewer", name: "Code Reviewer", category: "Code", description: "Reviews code for quality, bugs, and best practices", capabilities: ["code_review", "bug_detection", "style_checking"], riskLevel: "safe", costTier: "low", requiredTools: ["code_reader", "linter"] },
  { id: "code-debugger", name: "Debugger", category: "Code", description: "Identifies and fixes bugs in existing code", capabilities: ["debugging", "error_analysis", "fix_suggestion"], riskLevel: "moderate", costTier: "medium", requiredTools: ["code_executor", "debugger"] },
  { id: "code-refactorer", name: "Code Refactorer", category: "Code", description: "Refactors code for improved quality and maintainability", capabilities: ["refactoring", "pattern_application", "complexity_reduction"], riskLevel: "moderate", costTier: "medium", requiredTools: ["code_reader", "file_writer"] },
  { id: "code-tester", name: "Test Engineer", category: "Code", description: "Writes and runs automated tests", capabilities: ["test_generation", "test_execution", "coverage_analysis"], riskLevel: "safe", costTier: "low", requiredTools: ["code_executor", "test_runner"] },
  { id: "code-architect", name: "Software Architect", category: "Code", description: "Designs software architecture and system structures", capabilities: ["architecture_design", "pattern_selection", "scalability_planning"], riskLevel: "safe", costTier: "medium", requiredTools: ["diagram_generator", "document_writer"] },
  { id: "code-frontend", name: "Frontend Developer", category: "Code", description: "Builds user interfaces with React, CSS, and HTML", capabilities: ["ui_development", "component_creation", "responsive_design"], riskLevel: "moderate", costTier: "medium", requiredTools: ["code_executor", "file_writer"] },
  { id: "code-backend", name: "Backend Developer", category: "Code", description: "Builds server-side APIs and business logic", capabilities: ["api_development", "database_queries", "server_configuration"], riskLevel: "dangerous", costTier: "medium", requiredTools: ["code_executor", "file_writer", "db_client"] },
  { id: "code-database", name: "Database Engineer", category: "Code", description: "Designs and optimizes database schemas and queries", capabilities: ["schema_design", "query_optimization", "migration_creation"], riskLevel: "dangerous", costTier: "medium", requiredTools: ["db_client", "file_writer"] },
  { id: "code-devtools", name: "DevTools Specialist", category: "Code", description: "Creates developer tools, scripts, and automation", capabilities: ["script_creation", "tooling", "build_configuration"], riskLevel: "moderate", costTier: "low", requiredTools: ["code_executor", "file_writer"] },

  { id: "data-analyst", name: "Data Analyst", category: "Data", description: "Analyzes datasets and extracts meaningful insights", capabilities: ["data_analysis", "statistical_testing", "insight_extraction"], riskLevel: "safe", costTier: "medium", requiredTools: ["data_processor", "chart_generator"] },
  { id: "data-engineer", name: "Data Engineer", category: "Data", description: "Builds data pipelines and ETL processes", capabilities: ["pipeline_creation", "data_transformation", "etl_design"], riskLevel: "moderate", costTier: "medium", requiredTools: ["data_processor", "db_client"] },
  { id: "data-visualizer", name: "Data Visualizer", category: "Data", description: "Creates charts, graphs, and visual data representations", capabilities: ["chart_creation", "dashboard_design", "infographic_generation"], riskLevel: "safe", costTier: "low", requiredTools: ["chart_generator", "image_creator"] },
  { id: "data-cleaner", name: "Data Cleaner", category: "Data", description: "Cleans, normalizes, and validates datasets", capabilities: ["data_cleaning", "normalization", "deduplication"], riskLevel: "safe", costTier: "low", requiredTools: ["data_processor", "file_reader"] },
  { id: "data-scientist", name: "Data Scientist", category: "Data", description: "Applies ML models and statistical methods to data", capabilities: ["model_training", "feature_engineering", "prediction"], riskLevel: "moderate", costTier: "high", requiredTools: ["ml_runtime", "data_processor"] },
  { id: "data-scraper", name: "Data Scraper", category: "Data", description: "Extracts structured data from web pages and documents", capabilities: ["web_scraping", "data_extraction", "format_conversion"], riskLevel: "moderate", costTier: "low", requiredTools: ["web_scraper", "data_processor"] },
  { id: "data-warehouse", name: "Data Warehouse Specialist", category: "Data", description: "Manages data warehouse design and optimization", capabilities: ["warehouse_design", "olap_queries", "dimensional_modeling"], riskLevel: "moderate", costTier: "high", requiredTools: ["db_client", "data_processor"] },
  { id: "data-quality", name: "Data Quality Analyst", category: "Data", description: "Monitors and ensures data quality standards", capabilities: ["quality_assessment", "anomaly_detection", "validation_rules"], riskLevel: "safe", costTier: "low", requiredTools: ["data_processor", "alert_sender"] },
  { id: "data-migration", name: "Data Migration Specialist", category: "Data", description: "Plans and executes data migration between systems", capabilities: ["migration_planning", "schema_mapping", "data_transfer"], riskLevel: "dangerous", costTier: "medium", requiredTools: ["db_client", "data_processor"] },
  { id: "data-reporter", name: "Report Generator", category: "Data", description: "Generates formatted reports from data sources", capabilities: ["report_generation", "template_filling", "pdf_creation"], riskLevel: "safe", costTier: "low", requiredTools: ["data_processor", "document_writer"] },

  { id: "creative-writer", name: "Content Writer", category: "Creative", description: "Writes articles, blog posts, and marketing copy", capabilities: ["content_writing", "copywriting", "storytelling"], riskLevel: "safe", costTier: "medium", requiredTools: ["document_writer", "grammar_checker"] },
  { id: "creative-editor", name: "Content Editor", category: "Creative", description: "Edits and improves written content for clarity and impact", capabilities: ["editing", "proofreading", "tone_adjustment"], riskLevel: "safe", costTier: "low", requiredTools: ["document_reader", "grammar_checker"] },
  { id: "creative-translator", name: "Translator", category: "Creative", description: "Translates content between languages with cultural adaptation", capabilities: ["translation", "localization", "cultural_adaptation"], riskLevel: "safe", costTier: "medium", requiredTools: ["translation_api", "document_writer"] },
  { id: "creative-designer", name: "UI/UX Designer", category: "Creative", description: "Designs user interfaces and user experience flows", capabilities: ["ui_design", "wireframing", "prototyping"], riskLevel: "safe", costTier: "medium", requiredTools: ["design_tool", "image_creator"] },
  { id: "creative-image", name: "Image Generator", category: "Creative", description: "Creates and edits images using AI generation", capabilities: ["image_generation", "image_editing", "style_transfer"], riskLevel: "safe", costTier: "high", requiredTools: ["image_generator", "image_editor"] },
  { id: "creative-video", name: "Video Producer", category: "Creative", description: "Creates and edits video content and animations", capabilities: ["video_creation", "animation", "video_editing"], riskLevel: "safe", costTier: "premium", requiredTools: ["video_editor", "animation_tool"] },
  { id: "creative-audio", name: "Audio Producer", category: "Creative", description: "Creates and processes audio content including music and podcasts", capabilities: ["audio_generation", "audio_editing", "tts"], riskLevel: "safe", costTier: "high", requiredTools: ["audio_editor", "tts_engine"] },
  { id: "creative-presentation", name: "Presentation Designer", category: "Creative", description: "Creates professional presentations and slide decks", capabilities: ["slide_design", "presentation_creation", "visual_storytelling"], riskLevel: "safe", costTier: "medium", requiredTools: ["presentation_tool", "image_creator"] },
  { id: "creative-branding", name: "Brand Strategist", category: "Creative", description: "Develops branding strategies and brand identity elements", capabilities: ["brand_strategy", "identity_design", "style_guide_creation"], riskLevel: "safe", costTier: "medium", requiredTools: ["design_tool", "document_writer"] },
  { id: "creative-social-content", name: "Social Media Content Creator", category: "Creative", description: "Creates engaging content for social media platforms", capabilities: ["social_content", "hashtag_strategy", "engagement_optimization"], riskLevel: "safe", costTier: "low", requiredTools: ["image_creator", "document_writer"] },

  { id: "analysis-financial", name: "Financial Analyst", category: "Analysis", description: "Analyzes financial data, statements, and market metrics", capabilities: ["financial_analysis", "ratio_calculation", "valuation"], riskLevel: "moderate", costTier: "high", requiredTools: ["data_processor", "chart_generator"] },
  { id: "analysis-risk", name: "Risk Analyst", category: "Analysis", description: "Assesses and quantifies various types of risk", capabilities: ["risk_assessment", "probability_modeling", "impact_analysis"], riskLevel: "moderate", costTier: "medium", requiredTools: ["data_processor", "risk_model"] },
  { id: "analysis-sentiment", name: "Sentiment Analyst", category: "Analysis", description: "Analyzes text for sentiment and emotional tone", capabilities: ["sentiment_analysis", "opinion_mining", "emotion_detection"], riskLevel: "safe", costTier: "low", requiredTools: ["nlp_processor", "data_processor"] },
  { id: "analysis-statistical", name: "Statistical Analyst", category: "Analysis", description: "Performs statistical tests and modeling", capabilities: ["hypothesis_testing", "regression_analysis", "distribution_fitting"], riskLevel: "safe", costTier: "medium", requiredTools: ["stats_engine", "data_processor"] },
  { id: "analysis-business", name: "Business Analyst", category: "Analysis", description: "Analyzes business processes and identifies improvements", capabilities: ["process_analysis", "requirements_gathering", "gap_analysis"], riskLevel: "safe", costTier: "medium", requiredTools: ["document_reader", "diagram_generator"] },
  { id: "analysis-performance", name: "Performance Analyst", category: "Analysis", description: "Analyzes system and application performance metrics", capabilities: ["performance_profiling", "bottleneck_identification", "optimization_recommendation"], riskLevel: "safe", costTier: "low", requiredTools: ["metrics_collector", "chart_generator"] },
  { id: "analysis-text", name: "Text Analyst", category: "Analysis", description: "Extracts structured information from unstructured text", capabilities: ["ner", "topic_modeling", "text_classification"], riskLevel: "safe", costTier: "low", requiredTools: ["nlp_processor", "data_processor"] },
  { id: "analysis-predictive", name: "Predictive Analyst", category: "Analysis", description: "Builds predictive models and forecasts", capabilities: ["forecasting", "time_series_analysis", "predictive_modeling"], riskLevel: "moderate", costTier: "high", requiredTools: ["ml_runtime", "data_processor"] },
  { id: "analysis-compliance", name: "Compliance Analyst", category: "Analysis", description: "Analyzes compliance with regulations and standards", capabilities: ["compliance_checking", "policy_review", "audit_preparation"], riskLevel: "moderate", costTier: "medium", requiredTools: ["document_reader", "checklist_engine"] },
  { id: "analysis-user-behavior", name: "User Behavior Analyst", category: "Analysis", description: "Analyzes user behavior patterns and engagement metrics", capabilities: ["behavior_analysis", "funnel_analysis", "cohort_analysis"], riskLevel: "safe", costTier: "medium", requiredTools: ["analytics_api", "data_processor"] },

  { id: "devops-deployer", name: "Deployment Specialist", category: "DevOps", description: "Manages application deployments and releases", capabilities: ["deployment", "rollback", "blue_green_deploy"], riskLevel: "dangerous", costTier: "medium", requiredTools: ["deploy_tool", "shell_executor"] },
  { id: "devops-monitor", name: "Monitoring Specialist", category: "DevOps", description: "Sets up and manages monitoring and alerting", capabilities: ["monitoring_setup", "alert_configuration", "dashboard_creation"], riskLevel: "moderate", costTier: "low", requiredTools: ["metrics_collector", "alert_sender"] },
  { id: "devops-ci-cd", name: "CI/CD Engineer", category: "DevOps", description: "Builds and maintains continuous integration/deployment pipelines", capabilities: ["pipeline_creation", "build_optimization", "test_automation"], riskLevel: "moderate", costTier: "medium", requiredTools: ["ci_tool", "shell_executor"] },
  { id: "devops-infra", name: "Infrastructure Engineer", category: "DevOps", description: "Manages cloud infrastructure and IaC templates", capabilities: ["iac_creation", "resource_provisioning", "cost_optimization"], riskLevel: "critical", costTier: "high", requiredTools: ["cloud_api", "shell_executor"] },
  { id: "devops-container", name: "Container Specialist", category: "DevOps", description: "Manages Docker containers and Kubernetes orchestration", capabilities: ["container_management", "k8s_operations", "image_building"], riskLevel: "dangerous", costTier: "medium", requiredTools: ["docker_api", "k8s_api"] },

  { id: "security-auditor", name: "Security Auditor", category: "Security", description: "Conducts security audits and vulnerability assessments", capabilities: ["vulnerability_scanning", "security_audit", "penetration_testing"], riskLevel: "dangerous", costTier: "high", requiredTools: ["security_scanner", "code_reader"] },
  { id: "security-crypto", name: "Cryptography Specialist", category: "Security", description: "Implements and reviews cryptographic operations", capabilities: ["encryption", "key_management", "signature_verification"], riskLevel: "critical", costTier: "medium", requiredTools: ["crypto_library", "code_executor"] },
  { id: "security-access", name: "Access Control Specialist", category: "Security", description: "Manages authentication and authorization systems", capabilities: ["auth_configuration", "rbac_management", "sso_setup"], riskLevel: "critical", costTier: "medium", requiredTools: ["auth_system", "config_manager"] },
  { id: "security-incident", name: "Incident Responder", category: "Security", description: "Handles security incidents and forensic analysis", capabilities: ["incident_response", "forensic_analysis", "threat_mitigation"], riskLevel: "critical", costTier: "high", requiredTools: ["log_analyzer", "security_scanner"] },
  { id: "security-compliance", name: "Security Compliance Officer", category: "Security", description: "Ensures compliance with security standards and regulations", capabilities: ["compliance_audit", "policy_enforcement", "certification_prep"], riskLevel: "dangerous", costTier: "medium", requiredTools: ["compliance_checker", "document_reader"] },

  { id: "comm-email", name: "Email Composer", category: "Communication", description: "Drafts and sends professional emails", capabilities: ["email_drafting", "template_creation", "follow_up_scheduling"], riskLevel: "moderate", costTier: "low", requiredTools: ["email_sender", "document_writer"] },
  { id: "comm-notification", name: "Notification Manager", category: "Communication", description: "Manages multi-channel notifications and alerts", capabilities: ["notification_sending", "channel_routing", "priority_management"], riskLevel: "moderate", costTier: "low", requiredTools: ["notification_service", "template_engine"] },
  { id: "comm-chat", name: "Chat Assistant", category: "Communication", description: "Handles conversational interactions and support queries", capabilities: ["conversation_management", "query_resolution", "escalation"], riskLevel: "safe", costTier: "low", requiredTools: ["chat_api", "knowledge_base"] },
  { id: "comm-report-distributor", name: "Report Distributor", category: "Communication", description: "Distributes reports and documents to stakeholders", capabilities: ["report_distribution", "access_management", "delivery_tracking"], riskLevel: "moderate", costTier: "low", requiredTools: ["email_sender", "file_sharer"] },
  { id: "comm-meeting", name: "Meeting Coordinator", category: "Communication", description: "Schedules meetings and prepares agendas", capabilities: ["meeting_scheduling", "agenda_creation", "minutes_generation"], riskLevel: "safe", costTier: "low", requiredTools: ["calendar_api", "document_writer"] },

  { id: "plan-project", name: "Project Planner", category: "Planning", description: "Creates project plans with milestones and timelines", capabilities: ["project_planning", "milestone_tracking", "resource_allocation"], riskLevel: "safe", costTier: "medium", requiredTools: ["project_tool", "document_writer"] },
  { id: "plan-strategy", name: "Strategy Planner", category: "Planning", description: "Develops strategic plans and roadmaps", capabilities: ["strategic_planning", "roadmap_creation", "okr_setting"], riskLevel: "safe", costTier: "medium", requiredTools: ["document_writer", "diagram_generator"] },
  { id: "plan-sprint", name: "Sprint Planner", category: "Planning", description: "Plans agile sprints and manages backlog prioritization", capabilities: ["sprint_planning", "backlog_prioritization", "velocity_tracking"], riskLevel: "safe", costTier: "low", requiredTools: ["project_tool", "document_writer"] },
  { id: "plan-resource", name: "Resource Planner", category: "Planning", description: "Plans resource allocation and capacity management", capabilities: ["resource_planning", "capacity_analysis", "budget_allocation"], riskLevel: "moderate", costTier: "medium", requiredTools: ["data_processor", "chart_generator"] },
  { id: "plan-risk", name: "Risk Planner", category: "Planning", description: "Identifies risks and creates mitigation plans", capabilities: ["risk_identification", "mitigation_planning", "contingency_design"], riskLevel: "safe", costTier: "low", requiredTools: ["document_writer", "risk_model"] },

  { id: "domain-healthcare", name: "Healthcare Specialist", category: "Domain", description: "Provides expertise in healthcare data and medical information", capabilities: ["medical_analysis", "clinical_data_review", "health_informatics"], riskLevel: "dangerous", costTier: "high", requiredTools: ["medical_db", "document_reader"] },
  { id: "domain-finance", name: "Finance Domain Expert", category: "Domain", description: "Provides expertise in financial markets and instruments", capabilities: ["financial_modeling", "portfolio_analysis", "market_prediction"], riskLevel: "dangerous", costTier: "high", requiredTools: ["financial_api", "data_processor"] },
  { id: "domain-legal", name: "Legal Domain Expert", category: "Domain", description: "Provides expertise in legal matters and contract analysis", capabilities: ["contract_review", "legal_opinion", "regulatory_interpretation"], riskLevel: "dangerous", costTier: "high", requiredTools: ["legal_db", "document_reader"] },
  { id: "domain-education", name: "Education Specialist", category: "Domain", description: "Creates educational content and learning materials", capabilities: ["curriculum_design", "quiz_generation", "learning_path_creation"], riskLevel: "safe", costTier: "medium", requiredTools: ["document_writer", "quiz_generator"] },
  { id: "domain-ecommerce", name: "E-Commerce Specialist", category: "Domain", description: "Manages e-commerce operations and product catalogs", capabilities: ["product_management", "pricing_optimization", "inventory_analysis"], riskLevel: "moderate", costTier: "medium", requiredTools: ["ecommerce_api", "data_processor"] },
  { id: "domain-marketing", name: "Marketing Specialist", category: "Domain", description: "Develops marketing strategies and campaign plans", capabilities: ["campaign_planning", "audience_targeting", "roi_analysis"], riskLevel: "safe", costTier: "medium", requiredTools: ["analytics_api", "document_writer"] },
  { id: "domain-hr", name: "HR Specialist", category: "Domain", description: "Manages HR processes and employee data analysis", capabilities: ["recruitment_analysis", "performance_review", "policy_drafting"], riskLevel: "moderate", costTier: "medium", requiredTools: ["hr_system", "document_writer"] },
  { id: "domain-supply-chain", name: "Supply Chain Specialist", category: "Domain", description: "Optimizes supply chain operations and logistics", capabilities: ["logistics_optimization", "demand_forecasting", "vendor_management"], riskLevel: "moderate", costTier: "medium", requiredTools: ["erp_api", "data_processor"] },
  { id: "domain-real-estate", name: "Real Estate Analyst", category: "Domain", description: "Analyzes real estate markets and property valuations", capabilities: ["property_valuation", "market_comparison", "investment_analysis"], riskLevel: "moderate", costTier: "medium", requiredTools: ["real_estate_api", "data_processor"] },
  { id: "domain-insurance", name: "Insurance Specialist", category: "Domain", description: "Analyzes insurance policies and risk underwriting", capabilities: ["policy_analysis", "claim_assessment", "actuarial_modeling"], riskLevel: "dangerous", costTier: "high", requiredTools: ["insurance_db", "data_processor"] },
  { id: "domain-energy", name: "Energy Analyst", category: "Domain", description: "Analyzes energy markets and sustainability metrics", capabilities: ["energy_analysis", "sustainability_reporting", "carbon_tracking"], riskLevel: "moderate", costTier: "medium", requiredTools: ["energy_api", "data_processor"] },
  { id: "domain-agriculture", name: "Agriculture Specialist", category: "Domain", description: "Provides expertise in agricultural data and crop analysis", capabilities: ["crop_analysis", "yield_prediction", "weather_correlation"], riskLevel: "safe", costTier: "medium", requiredTools: ["weather_api", "data_processor"] },
  { id: "domain-telecom", name: "Telecom Specialist", category: "Domain", description: "Analyzes telecommunications networks and usage patterns", capabilities: ["network_analysis", "usage_optimization", "capacity_planning"], riskLevel: "moderate", costTier: "medium", requiredTools: ["telecom_api", "data_processor"] },
  { id: "domain-manufacturing", name: "Manufacturing Specialist", category: "Domain", description: "Optimizes manufacturing processes and quality control", capabilities: ["process_optimization", "quality_control", "defect_analysis"], riskLevel: "moderate", costTier: "medium", requiredTools: ["iot_api", "data_processor"] },
  { id: "domain-gaming", name: "Gaming Specialist", category: "Domain", description: "Designs game mechanics and analyzes player behavior", capabilities: ["game_design", "player_analytics", "monetization_analysis"], riskLevel: "safe", costTier: "medium", requiredTools: ["analytics_api", "data_processor"] },
  { id: "domain-travel", name: "Travel & Hospitality Specialist", category: "Domain", description: "Analyzes travel trends and hospitality operations", capabilities: ["booking_analysis", "route_optimization", "pricing_strategy"], riskLevel: "safe", costTier: "medium", requiredTools: ["travel_api", "data_processor"] },
  { id: "domain-media", name: "Media & Entertainment Specialist", category: "Domain", description: "Analyzes media trends and content performance", capabilities: ["content_analysis", "audience_measurement", "distribution_optimization"], riskLevel: "safe", costTier: "medium", requiredTools: ["media_api", "data_processor"] },
  { id: "domain-government", name: "Government & Public Sector Specialist", category: "Domain", description: "Analyzes public policy and government data", capabilities: ["policy_analysis", "public_data_mining", "civic_tech"], riskLevel: "moderate", costTier: "medium", requiredTools: ["gov_api", "data_processor"] },
  { id: "domain-biotech", name: "Biotech Specialist", category: "Domain", description: "Analyzes biotechnology research and genomic data", capabilities: ["genomic_analysis", "drug_discovery", "clinical_trial_analysis"], riskLevel: "dangerous", costTier: "premium", requiredTools: ["bio_db", "data_processor"] },
  { id: "domain-cybersecurity", name: "Cybersecurity Domain Expert", category: "Domain", description: "Provides deep cybersecurity threat intelligence", capabilities: ["threat_intelligence", "vulnerability_research", "attack_surface_mapping"], riskLevel: "critical", costTier: "high", requiredTools: ["threat_feed", "security_scanner"] },
  { id: "domain-automotive", name: "Automotive Specialist", category: "Domain", description: "Analyzes automotive industry data and vehicle technology", capabilities: ["vehicle_analysis", "market_forecasting", "ev_analytics"], riskLevel: "safe", costTier: "medium", requiredTools: ["automotive_api", "data_processor"] },
  { id: "domain-aerospace", name: "Aerospace Specialist", category: "Domain", description: "Analyzes aerospace engineering and aviation data", capabilities: ["flight_analysis", "maintenance_prediction", "safety_compliance"], riskLevel: "dangerous", costTier: "high", requiredTools: ["aviation_api", "data_processor"] },
  { id: "domain-sports", name: "Sports Analytics Specialist", category: "Domain", description: "Analyzes sports statistics and performance data", capabilities: ["performance_analytics", "player_evaluation", "game_prediction"], riskLevel: "safe", costTier: "medium", requiredTools: ["sports_api", "data_processor"] },
  { id: "domain-climate", name: "Climate & Environmental Specialist", category: "Domain", description: "Analyzes climate data and environmental impact", capabilities: ["climate_modeling", "emissions_tracking", "environmental_impact"], riskLevel: "moderate", costTier: "medium", requiredTools: ["climate_api", "data_processor"] },
  { id: "domain-philanthropy", name: "Philanthropy & Nonprofit Specialist", category: "Domain", description: "Analyzes nonprofit operations and social impact", capabilities: ["impact_measurement", "donor_analysis", "grant_writing"], riskLevel: "safe", costTier: "low", requiredTools: ["nonprofit_db", "document_writer"] },
  { id: "domain-crypto-blockchain", name: "Blockchain Specialist", category: "Domain", description: "Analyzes blockchain data and smart contracts", capabilities: ["chain_analysis", "smart_contract_audit", "defi_analytics"], riskLevel: "dangerous", costTier: "high", requiredTools: ["blockchain_api", "code_reader"] },
  { id: "domain-logistics", name: "Logistics Optimizer", category: "Domain", description: "Optimizes logistics routes and warehouse operations", capabilities: ["route_optimization", "warehouse_layout", "fleet_management"], riskLevel: "moderate", costTier: "medium", requiredTools: ["logistics_api", "data_processor"] },
  { id: "domain-food-safety", name: "Food Safety Specialist", category: "Domain", description: "Analyzes food safety compliance and quality standards", capabilities: ["safety_inspection", "haccp_analysis", "recall_monitoring"], riskLevel: "dangerous", costTier: "medium", requiredTools: ["food_safety_db", "document_reader"] },
  { id: "domain-construction", name: "Construction Specialist", category: "Domain", description: "Manages construction project analysis and building codes", capabilities: ["project_estimation", "code_compliance", "material_analysis"], riskLevel: "moderate", costTier: "medium", requiredTools: ["construction_db", "data_processor"] },
  { id: "domain-fashion", name: "Fashion & Retail Specialist", category: "Domain", description: "Analyzes fashion trends and retail operations", capabilities: ["trend_forecasting", "merchandising_optimization", "size_analytics"], riskLevel: "safe", costTier: "medium", requiredTools: ["retail_api", "data_processor"] },
];

const roleMap = new Map<string, AgentRole>();
const categoryMap = new Map<AgentCategory, AgentRole[]>();

for (const role of AGENT_ROLES) {
  roleMap.set(role.id, role);
  const list = categoryMap.get(role.category) || [];
  list.push(role);
  categoryMap.set(role.category, list);
}

export function getRoleById(id: string): AgentRole | undefined {
  return roleMap.get(id);
}

export function getAllRoles(): AgentRole[] {
  return [...AGENT_ROLES];
}

export function getRolesByCategory(category: AgentCategory): AgentRole[] {
  return categoryMap.get(category) || [];
}

export function matchRoles(taskDescription: string, maxResults: number = 5): AgentRole[] {
  const desc = taskDescription.toLowerCase();

  const scored = AGENT_ROLES.map(role => {
    let score = 0;

    const nameWords = role.name.toLowerCase().split(/\s+/);
    for (const word of nameWords) {
      if (desc.includes(word) && word.length > 2) score += 3;
    }

    const descWords = role.description.toLowerCase().split(/\s+/);
    for (const word of descWords) {
      if (desc.includes(word) && word.length > 3) score += 1;
    }

    for (const cap of role.capabilities) {
      const capWords = cap.replace(/_/g, " ").toLowerCase().split(/\s+/);
      for (const word of capWords) {
        if (desc.includes(word) && word.length > 3) score += 2;
      }
    }

    const categoryKeywords: Record<AgentCategory, string[]> = {
      Research: ["research", "find", "search", "lookup", "investigate", "discover", "explore"],
      Code: ["code", "program", "develop", "build", "implement", "debug", "fix", "refactor", "test"],
      Data: ["data", "dataset", "csv", "excel", "database", "etl", "pipeline", "clean", "transform"],
      Creative: ["write", "design", "create", "generate", "image", "video", "audio", "content", "brand"],
      Analysis: ["analyze", "analysis", "assess", "evaluate", "measure", "predict", "forecast", "sentiment"],
      DevOps: ["deploy", "monitor", "ci/cd", "infrastructure", "container", "kubernetes", "docker"],
      Security: ["security", "vulnerability", "encrypt", "audit", "compliance", "threat", "incident"],
      Communication: ["email", "notify", "message", "meeting", "communicate", "distribute", "chat"],
      Planning: ["plan", "strategy", "roadmap", "sprint", "project", "resource", "schedule", "milestone"],
      Domain: ["healthcare", "finance", "legal", "education", "ecommerce", "marketing", "blockchain", "biotech"],
    };

    for (const [cat, keywords] of Object.entries(categoryKeywords)) {
      if (cat === role.category) {
        for (const kw of keywords) {
          if (desc.includes(kw)) score += 2;
        }
      }
    }

    return { role, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.role);
}
