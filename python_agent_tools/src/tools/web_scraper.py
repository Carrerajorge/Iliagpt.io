"""Web scraping tool with aiohttp and BeautifulSoup."""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry
from ..utils.retry import async_retry
import aiohttp
from bs4 import BeautifulSoup
import re
from urllib.parse import urljoin, urlparse


class ScrapedContent(BaseModel):
    """Model for scraped web content."""
    title: Optional[str] = None
    text: str
    links: List[str] = []
    images: List[str] = []
    metadata: Dict[str, Any] = {}


class WebScraperInput(ToolInput):
    """Input for web scraper tool."""
    url: str = Field(..., description="URL to scrape")
    extract_links: bool = Field(True, description="Extract links from page")
    extract_images: bool = Field(False, description="Extract image URLs")
    selector: Optional[str] = Field(None, description="CSS selector to target specific content")
    max_text_length: int = Field(50000, ge=100, le=500000, description="Maximum text length")
    timeout: int = Field(30, ge=5, le=120, description="Request timeout in seconds")
    user_agent: Optional[str] = Field(None, description="Custom user agent string")


class WebScraperOutput(ToolOutput):
    """Output from web scraper tool."""
    data: Optional[ScrapedContent] = None


ALLOWED_SCHEMES = {"http", "https"}
DEFAULT_USER_AGENT = "Mozilla/5.0 (compatible; AgentTools/1.0; +https://example.com/bot)"


def validate_url(url: str) -> bool:
    """Validate URL scheme and format."""
    try:
        parsed = urlparse(url)
        return parsed.scheme in ALLOWED_SCHEMES and bool(parsed.netloc)
    except Exception:
        return False


def clean_text(text: str) -> str:
    """Clean extracted text by removing excess whitespace."""
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


@ToolRegistry.register
class WebScraperTool(BaseTool[WebScraperInput, WebScraperOutput]):
    """Tool for scraping web pages and extracting content."""
    
    name = "web_scraper"
    description = "Scrapes web pages and extracts content including text, links, and images"
    category = ToolCategory.WEB
    priority = Priority.HIGH
    dependencies = ["sanitize_input"]
    
    @async_retry(max_attempts=3)
    async def execute(self, input: WebScraperInput) -> WebScraperOutput:
        """Execute web scraping operation."""
        self.logger.info("web_scrape_start", url=input.url[:100])
        
        if not validate_url(input.url):
            return WebScraperOutput(
                success=False,
                error="Invalid URL: must be http or https scheme"
            )
        
        try:
            user_agent = input.user_agent or DEFAULT_USER_AGENT
            headers = {"User-Agent": user_agent}
            
            timeout = aiohttp.ClientTimeout(total=input.timeout)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(input.url, headers=headers) as response:
                    if response.status != 200:
                        return WebScraperOutput(
                            success=False,
                            error=f"HTTP error: {response.status}"
                        )
                    
                    html = await response.text()
            
            soup = BeautifulSoup(html, "html.parser")
            
            for script in soup(["script", "style", "noscript"]):
                script.decompose()
            
            if input.selector:
                target = soup.select_one(input.selector)
                if not target:
                    return WebScraperOutput(
                        success=False,
                        error=f"Selector '{input.selector}' not found"
                    )
            else:
                target = soup.body or soup
            
            title_tag = soup.find("title")
            title = title_tag.get_text(strip=True) if title_tag else None
            
            text = clean_text(target.get_text(separator=" "))
            if len(text) > input.max_text_length:
                text = text[:input.max_text_length] + "..."
            
            links: List[str] = []
            if input.extract_links:
                for a_tag in target.find_all("a", href=True):
                    href = str(a_tag["href"])
                    absolute_url = urljoin(input.url, href)
                    if validate_url(absolute_url):
                        links.append(absolute_url)
                links = list(set(links))[:100]
            
            images: List[str] = []
            if input.extract_images:
                for img_tag in target.find_all("img", src=True):
                    src = str(img_tag["src"])
                    absolute_url = urljoin(input.url, src)
                    images.append(absolute_url)
                images = list(set(images))[:50]
            
            meta_desc = soup.find("meta", attrs={"name": "description"})
            meta_keywords = soup.find("meta", attrs={"name": "keywords"})
            
            metadata = {
                "description": meta_desc.get("content", "") if meta_desc else "",
                "keywords": meta_keywords.get("content", "") if meta_keywords else "",
                "url": input.url,
                "content_length": len(text),
            }
            
            content = ScrapedContent(
                title=title,
                text=text,
                links=links,
                images=images,
                metadata=metadata
            )
            
            self.logger.info(
                "web_scrape_complete",
                url=input.url[:50],
                text_length=len(text),
                links_count=len(links),
                images_count=len(images)
            )
            
            return WebScraperOutput(
                success=True,
                data=content,
                metadata={"scraped_url": input.url}
            )
            
        except aiohttp.ClientError as e:
            self.logger.error("web_scrape_client_error", error=str(e))
            return WebScraperOutput(
                success=False,
                error=f"Network error: {str(e)}"
            )
        except Exception as e:
            self.logger.error("web_scrape_error", error=str(e))
            return WebScraperOutput(
                success=False,
                error=f"Scraping failed: {str(e)}"
            )
