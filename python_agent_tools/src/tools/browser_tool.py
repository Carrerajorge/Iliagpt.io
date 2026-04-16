"""Browser automation tool using Playwright."""

from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry
from ..utils.retry import async_retry
from urllib.parse import urlparse
import base64


ALLOWED_SCHEMES = {"http", "https"}
MAX_TIMEOUT = 60000
DEFAULT_TIMEOUT = 30000
MAX_VIEWPORT_WIDTH = 3840
MAX_VIEWPORT_HEIGHT = 2160


def validate_url(url: str) -> bool:
    """Validate URL scheme and format."""
    try:
        parsed = urlparse(url)
        return parsed.scheme in ALLOWED_SCHEMES and bool(parsed.netloc)
    except Exception:
        return False


class BrowserAction(BaseModel):
    """Single browser action to execute."""
    action: Literal["goto", "click", "fill", "screenshot", "pdf", "wait", "evaluate"]
    selector: Optional[str] = None
    value: Optional[str] = None
    options: Dict[str, Any] = {}


class BrowserResult(BaseModel):
    """Result from browser operations."""
    url: str
    title: str
    screenshot: Optional[str] = None
    pdf: Optional[str] = None
    html: Optional[str] = None
    evaluation_result: Optional[Any] = None


class BrowserToolInput(ToolInput):
    """Input for browser automation tool."""
    url: str = Field(..., description="URL to navigate to")
    actions: List[BrowserAction] = Field(
        default=[],
        description="List of browser actions to execute"
    )
    viewport_width: int = Field(1280, ge=320, le=MAX_VIEWPORT_WIDTH)
    viewport_height: int = Field(720, ge=200, le=MAX_VIEWPORT_HEIGHT)
    timeout: int = Field(DEFAULT_TIMEOUT, ge=1000, le=MAX_TIMEOUT)
    wait_until: Literal["load", "domcontentloaded", "networkidle"] = Field("load")
    headless: bool = Field(True, description="Run browser in headless mode")
    take_screenshot: bool = Field(False, description="Take final screenshot")
    generate_pdf: bool = Field(False, description="Generate PDF of page")
    extract_html: bool = Field(False, description="Extract page HTML")


class BrowserToolOutput(ToolOutput):
    """Output from browser automation tool."""
    data: Optional[BrowserResult] = None


@ToolRegistry.register
class BrowserTool(BaseTool[BrowserToolInput, BrowserToolOutput]):
    """Tool for browser automation using Playwright."""
    
    name = "browser_tool"
    description = "Automates browser operations including navigation, screenshots, PDF generation, and form filling"
    category = ToolCategory.WEB
    priority = Priority.HIGH
    dependencies = []
    
    @async_retry(max_attempts=2)
    async def execute(self, input: BrowserToolInput) -> BrowserToolOutput:
        """Execute browser automation."""
        self.logger.info("browser_start", url=input.url[:100])
        
        if not validate_url(input.url):
            return BrowserToolOutput(
                success=False,
                error="Invalid URL: must be http or https scheme"
            )
        
        try:
            from playwright.async_api import async_playwright  # type: ignore[import-not-found]
        except ImportError:
            return BrowserToolOutput(
                success=False,
                error="Playwright not installed. Run: pip install playwright && playwright install"
            )
        
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=input.headless)
                context = await browser.new_context(
                    viewport={
                        "width": input.viewport_width,
                        "height": input.viewport_height
                    }
                )
                page = await context.new_page()
                page.set_default_timeout(input.timeout)
                
                await page.goto(input.url, wait_until=input.wait_until)
                
                evaluation_result = None
                for action in input.actions:
                    if action.action == "goto":
                        if action.value and validate_url(action.value):
                            await page.goto(action.value, wait_until=input.wait_until)
                    
                    elif action.action == "click":
                        if action.selector:
                            await page.click(action.selector, **action.options)
                    
                    elif action.action == "fill":
                        if action.selector and action.value is not None:
                            await page.fill(action.selector, action.value)
                    
                    elif action.action == "wait":
                        wait_time = min(int(action.value or 1000), 10000)
                        await page.wait_for_timeout(wait_time)
                    
                    elif action.action == "evaluate":
                        if action.value:
                            safe_script = action.value[:5000]
                            evaluation_result = await page.evaluate(safe_script)
                
                current_url = page.url
                title = await page.title()
                
                screenshot_b64 = None
                if input.take_screenshot:
                    screenshot_bytes = await page.screenshot(full_page=False)
                    screenshot_b64 = base64.b64encode(screenshot_bytes).decode("utf-8")
                
                pdf_b64 = None
                if input.generate_pdf:
                    pdf_bytes = await page.pdf(format="A4")
                    pdf_b64 = base64.b64encode(pdf_bytes).decode("utf-8")
                
                html_content = None
                if input.extract_html:
                    html_content = await page.content()
                    if len(html_content) > 500000:
                        html_content = html_content[:500000] + "<!-- truncated -->"
                
                await browser.close()
                
                result = BrowserResult(
                    url=current_url,
                    title=title,
                    screenshot=screenshot_b64,
                    pdf=pdf_b64,
                    html=html_content,
                    evaluation_result=evaluation_result
                )
                
                self.logger.info(
                    "browser_complete",
                    url=current_url[:50],
                    actions_count=len(input.actions)
                )
                
                return BrowserToolOutput(
                    success=True,
                    data=result,
                    metadata={
                        "final_url": current_url,
                        "title": title,
                        "actions_executed": len(input.actions)
                    }
                )
                
        except Exception as e:
            self.logger.error("browser_error", error=str(e))
            return BrowserToolOutput(
                success=False,
                error=f"Browser automation failed: {str(e)}"
            )
