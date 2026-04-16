/**
 * Share Project Modal
 * 
 * Modal for sharing projects via link or with specific users.
 */

import { useState, useCallback } from "react";
import { Share2, Copy, Check, Link, Users, Globe, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import type { Project } from "@/hooks/use-projects";

interface ShareProjectModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    project: Project | null;
}

export function ShareProjectModal({
    open,
    onOpenChange,
    project
}: ShareProjectModalProps) {
    const [shareType, setShareType] = useState<"private" | "link" | "public">("private");
    const [copied, setCopied] = useState(false);
    const [email, setEmail] = useState("");
    const [invitedEmails, setInvitedEmails] = useState<string[]>([]);

    if (!project) return null;

    // Generate shareable link (simulated)
    const shareLink = `${window.location.origin}/shared/project/${project.id}`;

    const handleCopyLink = useCallback(() => {
        navigator.clipboard.writeText(shareLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [shareLink]);

    const handleInvite = useCallback(() => {
        if (email.trim() && email.includes("@")) {
            setInvitedEmails([...invitedEmails, email.trim()]);
            setEmail("");
        }
    }, [email, invitedEmails]);

    const handleRemoveInvite = useCallback((emailToRemove: string) => {
        setInvitedEmails(invitedEmails.filter(e => e !== emailToRemove));
    }, [invitedEmails]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Share2 className="h-5 w-5" />
                        Share Project
                    </DialogTitle>
                    <DialogDescription>
                        Share "{project.name}" with others
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    {/* Visibility Options */}
                    <div className="space-y-3">
                        <Label>Who can access</Label>
                        <RadioGroup value={shareType} onValueChange={(v) => setShareType(v as any)}>
                            <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-accent/50 cursor-pointer">
                                <RadioGroupItem value="private" id="private" />
                                <Lock className="h-4 w-4 text-muted-foreground" />
                                <div className="flex-1">
                                    <Label htmlFor="private" className="cursor-pointer font-medium">Private</Label>
                                    <p className="text-xs text-muted-foreground">Only you can access</p>
                                </div>
                            </div>
                            <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-accent/50 cursor-pointer">
                                <RadioGroupItem value="link" id="link" />
                                <Link className="h-4 w-4 text-muted-foreground" />
                                <div className="flex-1">
                                    <Label htmlFor="link" className="cursor-pointer font-medium">Anyone with link</Label>
                                    <p className="text-xs text-muted-foreground">Anyone with the link can view</p>
                                </div>
                            </div>
                            <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-accent/50 cursor-pointer">
                                <RadioGroupItem value="public" id="public" />
                                <Globe className="h-4 w-4 text-muted-foreground" />
                                <div className="flex-1">
                                    <Label htmlFor="public" className="cursor-pointer font-medium">Public</Label>
                                    <p className="text-xs text-muted-foreground">Visible to everyone</p>
                                </div>
                            </div>
                        </RadioGroup>
                    </div>

                    {shareType !== "private" && (
                        <>
                            <Separator />

                            {/* Share Link */}
                            <div className="space-y-2">
                                <Label>Share link</Label>
                                <div className="flex gap-2">
                                    <Input
                                        value={shareLink}
                                        readOnly
                                        className="font-mono text-sm"
                                    />
                                    <Button variant="outline" onClick={handleCopyLink}>
                                        {copied ? (
                                            <Check className="h-4 w-4 text-green-500" />
                                        ) : (
                                            <Copy className="h-4 w-4" />
                                        )}
                                    </Button>
                                </div>
                            </div>

                            <Separator />

                            {/* Invite by Email */}
                            <div className="space-y-3">
                                <Label>Invite people</Label>
                                <div className="flex gap-2">
                                    <Input
                                        type="email"
                                        placeholder="Enter email address"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                                    />
                                    <Button onClick={handleInvite} disabled={!email.includes("@")}>
                                        <Users className="h-4 w-4 mr-1" />
                                        Invite
                                    </Button>
                                </div>

                                {invitedEmails.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {invitedEmails.map((inviteEmail) => (
                                            <div
                                                key={inviteEmail}
                                                className="flex items-center gap-1 px-2 py-1 rounded-full bg-muted text-sm"
                                            >
                                                <span>{inviteEmail}</span>
                                                <button
                                                    className="h-4 w-4 rounded-full hover:bg-muted-foreground/20 flex items-center justify-center"
                                                    onClick={() => handleRemoveInvite(inviteEmail)}
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={() => {
                        // Save share settings
                        console.log("Share settings saved:", { shareType, invitedEmails });
                        onOpenChange(false);
                    }}>
                        Save
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default ShareProjectModal;
