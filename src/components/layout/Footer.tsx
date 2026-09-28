import { Link } from "react-router-dom";
import { Facebook, Instagram, Phone, Mail, MapPin } from "lucide-react";

export const Footer = () => {
  return (
    <footer className="bg-background border-t border-border">
      <div className="container mx-auto px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
          <div className="md:col-span-1">
            <Link to="/" className="flex items-center mb-4 w-fit">
              <img
                src="https://vibe.filesafe.space/1784303289974857996/attachments/8ecad49f-971d-43a4-b304-61aaa10f4894.png"
                alt="Midwest Christian Academy"
                className="h-16 w-auto object-contain mix-blend-multiply"
              />
            </Link>
            <p className="text-sm text-foreground/80 mb-4">
              Accredited Homeschool Services. A three-generation family business
              helping parents confidently educate their children.
            </p>
            <div className="flex space-x-4">
              <a
                href="https://www.facebook.com/MidwestChristianAcademy"
                target="_blank"
                rel="noreferrer"
                className="text-foreground/80 hover:text-accent"
              >
                <span className="sr-only">Facebook</span>
                <Facebook className="h-5 w-5" />
              </a>
              <a
                href="https://www.instagram.com/midwestchristianacademy"
                target="_blank"
                rel="noreferrer"
                className="text-foreground/80 hover:text-accent"
              >
                <span className="sr-only">Instagram</span>
                <Instagram className="h-5 w-5" />
              </a>
            </div>
          </div>

          <div>
            <h3 className="font-serif text-lg font-bold mb-4 text-primary">
              Quick Links
            </h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  to="/our-story"
                  className="text-foreground/80 hover:text-accent"
                >
                  Our Story
                </Link>
              </li>
              <li>
                <Link
                  to="/our-approach"
                  className="text-foreground/80 hover:text-accent"
                >
                  Our Approach
                </Link>
              </li>
              <li>
                <Link
                  to="/curriculum-guide"
                  className="text-foreground/80 hover:text-accent"
                >
                  Free Curriculum Guide
                </Link>
              </li>
              <li>
                <Link
                  to="/store"
                  className="text-foreground/80 hover:text-accent"
                >
                  Store
                </Link>
              </li>
              <li>
                <Link
                  to="/portal"
                  className="text-foreground/80 hover:text-accent"
                >
                  Parent Portal
                </Link>
              </li>
              <li>
                <Link
                  to="/enroll"
                  className="text-foreground/80 hover:text-accent"
                >
                  Enroll
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-serif text-lg font-bold mb-4 text-primary">
              Contact Us
            </h3>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <Phone className="h-5 w-5 text-accent shrink-0" />
                <span className="text-foreground/80">(844) 663-4477</span>
              </li>
              <li className="flex items-start gap-3">
                <Mail className="h-5 w-5 text-accent shrink-0" />
                <a
                  href="mailto:David@midwestchristianacademy.com"
                  className="text-foreground/80 hover:text-accent break-all"
                >
                  David@midwestchristianacademy.com
                </a>
              </li>
              <li className="flex items-start gap-3">
                <MapPin className="h-5 w-5 text-accent shrink-0" />
                <span className="text-foreground/80">
                  2300 NW 32nd Street
                  <br />
                  Newcastle, OK 73065
                </span>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-serif text-lg font-bold mb-4 text-primary">
              Office Hours
            </h3>
            <p className="text-sm text-foreground/80">
              Monday – Thursday
              <br />
              8:00 AM – 4:30 PM
            </p>
          </div>
        </div>

        <div className="mt-12 border-t border-border pt-8 text-center text-sm text-foreground/60">
          <p>
            &copy; {new Date().getFullYear()} Midwest Christian Academy LLC. All
            rights reserved.
          </p>
          <p className="mt-2">
            <Link to="/admin" className="hover:text-accent">
              Staff Login
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
};
