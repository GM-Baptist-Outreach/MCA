import { useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);

  const navLinks = [
    { name: "Our Story", path: "/our-story" },
    { name: "Our Approach", path: "/our-approach" },
    { name: "Store", path: "/store" },
    { name: "Parent Portal", path: "/portal" },
    { name: "Free Curriculum Guide", path: "/curriculum-guide" },
    { name: "Contact", path: "/contact" },
  ];

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90 shadow-xs">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-20 sm:h-24 items-center justify-between gap-4">
          <div className="flex items-center shrink-0">
            <Link to="/" className="flex items-center">
              <img
                src="https://vibe.filesafe.space/1784303289974857996/attachments/5ce70202-91c1-463f-929b-e89f47f07a50.png"
                alt="Midwest Christian Academy — Accredited Homeschool Services"
                className="h-12 sm:h-16 md:h-18 w-auto max-w-[240px] sm:max-w-[320px] md:max-w-[380px] object-contain drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]"
              />
            </Link>
          </div>

          {/* Desktop Nav */}
          <div className="hidden lg:block">
            <div className="flex items-center space-x-6 xl:space-x-8">
              {navLinks.map((link) => (
                <Link
                  key={link.name}
                  to={link.path}
                  className="text-sm font-medium text-foreground/80 transition-colors hover:text-primary"
                >
                  {link.name}
                </Link>
              ))}
              <Button
                asChild
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Link to="/enroll">Enroll</Link>
              </Button>
            </div>
          </div>

          {/* Mobile menu button */}
          <div className="flex lg:hidden">
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="inline-flex items-center justify-center rounded-md p-2 text-foreground hover:bg-accent/20 hover:text-primary focus:outline-none"
            >
              <span className="sr-only">Open main menu</span>
              {isOpen ? (
                <X className="block h-6 w-6" />
              ) : (
                <Menu className="block h-6 w-6" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Nav */}
      {isOpen && (
        <div className="lg:hidden border-t">
          <div className="space-y-1 px-2 pb-3 pt-2 sm:px-3 bg-background">
            {navLinks.map((link) => (
              <Link
                key={link.name}
                to={link.path}
                className="block rounded-md px-3 py-2 text-base font-medium text-foreground hover:bg-accent/10 hover:text-primary"
                onClick={() => setIsOpen(false)}
              >
                {link.name}
              </Link>
            ))}
            <Link
              to="/enroll"
              className="block rounded-md px-3 py-2 text-base font-medium text-primary font-bold hover:bg-accent/10"
              onClick={() => setIsOpen(false)}
            >
              Enroll
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
};
